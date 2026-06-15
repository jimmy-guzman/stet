/**
 * Collects diagnostics language servers push (`textDocument/publishDiagnostics`) and projects them
 * onto the keyed `CheckerState` the UI already renders. Per run: changed files are grouped by
 * language, each group's server is acquired from the warm pool, every file is opened with its
 * on-disk text, the run waits for the server to publish, then snapshots and closes. Every failure
 * degrades a file to `failed`/`unavailable` rather than erroring the stream, so a server hiccup
 * never blanks the panel. A file the server has not published for yet stays `pending`, never
 * falsely `clean` (the SPEC invariant). (Push is the baseline most servers implement, incl.
 * typescript- language-server; pull diagnostics are a deferred enhancement for servers that
 * advertise them.)
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { Context, Effect, Layer, Stream } from "effect";

import type { ChangedFile } from "../git/model";
import {
  stateForResolvedChecker,
  type CheckerFileState,
  type CheckerName,
  type Diagnostic,
} from "./checker";
import { isLspDiagnostic, mapLspDiagnostic } from "./protocol";
import { languageForPath, LanguageServers, lspLanguageId, type ServerHandle } from "./servers";
import type { LspConnection } from "./transport";

export interface CheckerUpdate {
  checker: CheckerName;
  state: Map<string, CheckerFileState>;
}

export class Diagnostics extends Context.Service<
  Diagnostics,
  {
    readonly run: (repoRoot: string, files: ChangedFile[]) => Stream.Stream<CheckerUpdate>;
  }
>()("sideye/Diagnostics") {}

function mapItems(items: unknown[], uri: string): Diagnostic[] {
  return items
    .filter(isLspDiagnostic)
    .map((item) => Object.assign(mapLspDiagnostic(item, uri), { checker: "diagnostics" as const }));
}

const SETTLE_INTERVAL = "50 millis";
// ~10s cap: long enough for a cold tsserver to finish loading and publish, but short-circuited the
// Moment the server dies. A file still unpublished at the cap stays pending, not falsely clean.
const SETTLE_ATTEMPTS = 200;
// Some servers publish an empty array on didOpen, then the real diagnostics once analysis finishes;
// A short grace after first-publish lets that refining publish land before the snapshot.
const SETTLE_GRACE = "250 millis";

/**
 * Waits until every opened document has been published at least once, the server dies, or the cap
 * elapses. Servers push `publishDiagnostics` asynchronously after `didOpen`; an empty array still
 * counts as published, so a clean file settles too.
 */
function settle(connection: LspConnection, uris: string[], attempt = 0): Effect.Effect<void> {
  if (uris.length === 0) {
    return Effect.void;
  }
  return Effect.all([connection.published, connection.closed]).pipe(
    Effect.flatMap(([map, isClosed]) =>
      isClosed || attempt >= SETTLE_ATTEMPTS || uris.every((uri) => map.has(uri))
        ? Effect.void
        : Effect.sleep(SETTLE_INTERVAL).pipe(Effect.andThen(settle(connection, uris, attempt + 1))),
    ),
  );
}

interface Collected {
  diagnostics: Diagnostic[];
  /** Files the server published for (clean or findings). */
  resolved: ChangedFile[];
  /** Files still awaiting a first publish (cold start, slow server) — render as pending. */
  pending: ChangedFile[];
}

function collectDiagnostics(handle: ServerHandle, repoRoot: string, files: ChangedFile[]) {
  return Effect.gen(function* collect() {
    const opened: { file: ChangedFile; uri: string }[] = [];
    const pending: ChangedFile[] = [];
    for (const file of files) {
      const absolute = join(repoRoot, file.path);
      // A file deleted between model load and this run can't be read; leave it pending for next run.
      const text = yield* Effect.promise(() =>
        Bun.file(absolute)
          .text()
          .catch(() => undefined),
      );
      if (text === undefined) {
        pending.push(file);
        continue;
      }
      const uri = pathToFileURL(absolute).href;
      yield* handle.connection.clearPublished([uri]);
      yield* handle.connection.notify("textDocument/didOpen", {
        textDocument: { languageId: lspLanguageId(file.path), text, uri, version: 1 },
      });
      opened.push({ file, uri });
    }

    yield* settle(
      handle.connection,
      opened.map((entry) => entry.uri),
    );
    if (opened.length > 0) {
      yield* Effect.sleep(SETTLE_GRACE);
    }
    const map = yield* handle.connection.published;

    const diagnostics: Diagnostic[] = [];
    const resolved: ChangedFile[] = [];
    for (const { file, uri } of opened) {
      const items = map.get(uri);
      if (items === undefined) {
        pending.push(file);
      } else {
        resolved.push(file);
        diagnostics.push(...mapItems(items, uri));
      }
    }

    yield* Effect.forEach(
      opened,
      (entry) =>
        handle.connection.notify("textDocument/didClose", { textDocument: { uri: entry.uri } }),
      { discard: true },
    );
    return { diagnostics, pending, resolved };
  });
}

type LanguageOutcome =
  | { kind: "diagnostics"; collected: Collected }
  | { kind: "degraded"; status: "failed" | "unavailable"; message: string }
  | { kind: "installing"; message: string };

export const DiagnosticsLive = Layer.effect(
  Diagnostics,
  Effect.gen(function* diagnosticsLive() {
    const servers = yield* LanguageServers;

    function runLanguage(repoRoot: string, language: string, files: ChangedFile[]) {
      return servers.acquire(language, repoRoot).pipe(
        Effect.flatMap(
          (handle): Effect.Effect<LanguageOutcome> =>
            collectDiagnostics(handle, repoRoot, files).pipe(
              Effect.map((collected) => ({ collected, kind: "diagnostics" })),
            ),
        ),
        Effect.catchTag("ServerUnavailable", (error) =>
          Effect.succeed<LanguageOutcome>({
            kind: "degraded",
            message: error.message,
            status: "unavailable",
          }),
        ),
        Effect.catchTag("ServerInstalling", (error) =>
          Effect.succeed<LanguageOutcome>({
            kind: "installing",
            message: `installing the ${error.language} language server…`,
          }),
        ),
        Effect.catch((error) =>
          Effect.succeed<LanguageOutcome>({
            kind: "degraded",
            message: error.message,
            status: "failed",
          }),
        ),
      );
    }

    function buildUpdate(repoRoot: string, files: ChangedFile[]) {
      return Effect.scoped(
        Effect.gen(function* build() {
          const changed = files.filter((file) => file.kind !== "deleted");
          const grouped = Map.groupBy(changed, (file) => languageForPath(file.path) ?? "");

          const reported: Diagnostic[] = [];
          const resolved: ChangedFile[] = [];
          const pendingFiles: ChangedFile[] = [];
          const degraded = new Map<string, CheckerFileState>();
          const degrade = (
            langFiles: ChangedFile[],
            status: "failed" | "unavailable",
            message: string,
          ) => {
            for (const file of langFiles) {
              degraded.set(file.path, { count: 0, diagnostics: [], message, status });
            }
          };

          for (const [language, langFiles] of grouped) {
            if (language === "") {
              degrade(langFiles, "unavailable", "no language server for this file type");
              continue;
            }
            const outcome = yield* runLanguage(repoRoot, language, langFiles);
            if (outcome.kind === "diagnostics") {
              reported.push(...outcome.collected.diagnostics);
              resolved.push(...outcome.collected.resolved);
              pendingFiles.push(...outcome.collected.pending);
            } else if (outcome.kind === "installing") {
              // Still downloading the server: pending with a message, never unavailable or clean.
              for (const file of langFiles) {
                degraded.set(file.path, {
                  count: 0,
                  diagnostics: [],
                  message: outcome.message,
                  status: "pending",
                });
              }
            } else {
              degrade(langFiles, outcome.status, outcome.message);
            }
          }

          const state = stateForResolvedChecker("diagnostics", resolved, reported, repoRoot);
          for (const file of pendingFiles) {
            state.set(file.path, { count: 0, diagnostics: [], status: "pending" });
          }
          for (const [path, fileState] of degraded) {
            state.set(path, fileState);
          }
          return { checker: "diagnostics", state } satisfies CheckerUpdate;
        }),
      );
    }

    return {
      run: (repoRoot, files) => Stream.fromEffect(buildUpdate(repoRoot, files)),
    };
  }),
);
