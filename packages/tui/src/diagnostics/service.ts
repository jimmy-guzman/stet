/**
 * Collects language-server diagnostics and projects them onto the keyed `CheckerState` the UI
 * already renders. Per run: changed files are grouped by language, each group's server is acquired
 * from the warm pool, and every file is opened with its on-disk text. Retrieval is hybrid: a server
 * advertising `diagnosticProvider` is pulled (one `textDocument/diagnostic` per file, push bucket
 * unioned in), every other server keeps the push path (wait for `publishDiagnostics`, then
 * snapshot); both close the docs after. Every failure degrades a file to `failed`/`unavailable`
 * rather than erroring the stream, so a server hiccup never blanks the panel. A file the server has
 * not answered for stays `pending`, never falsely `clean` (the SPEC invariant).
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { Context, Effect, Layer, Stream } from "effect";

import type { ChangedFile } from "@/git/model";

import { stateForResolvedChecker } from "./checker";
import type { CheckerFileState, CheckerName, Diagnostic } from "./checker";
import { isLspDiagnostic, mapLspDiagnostic } from "./protocol";
import { activeLanguages, LanguageServers, lspLanguageId, serversForPath } from "./servers";
import type { ServerHandle } from "./servers";
import type { LspConnection } from "./transport";

export interface CheckerUpdate {
  checker: CheckerName;
  state: Map<string, CheckerFileState>;
}

export class Diagnostics extends Context.Service<
  Diagnostics,
  {
    readonly run: (
      repoRoot: string,
      files: ChangedFile[],
      prior?: ReadonlyMap<string, CheckerFileState>,
    ) => Stream.Stream<CheckerUpdate>;
  }
>()("stet/Diagnostics") {}

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

// One pull request's ceiling: past it the file stays pending and the next run retries, so a cold
// Server that needs longer to index (rust-analyzer on a big crate) converges without wedging a run.
const PULL_TIMEOUT = "10 seconds";
const PULL_CONCURRENCY = 8;

interface Collected {
  diagnostics: Diagnostic[];
  /** Files the server answered for (clean or findings). */
  resolved: ChangedFile[];
  /** Files still awaiting an answer (cold start, slow server) — render as pending. */
  pending: ChangedFile[];
  /** Files whose pull the server rejected outright; render as failed with its message. */
  failed: { file: ChangedFile; message: string }[];
}

/**
 * The pull path: one `textDocument/diagnostic` round trip per opened file, no settle heuristics.
 * The push bucket is still read and unioned per uri, because a hybrid server (rust-analyzer)
 * answers pulls with its native findings while pushing its cargo-check ones. A timeout leaves the
 * file pending (the next run retries); a server error marks it failed, never falsely clean.
 */
function pullDiagnostics(handle: ServerHandle, opened: { file: ChangedFile; uri: string }[]) {
  return Effect.gen(function* pull() {
    const outcomes = yield* Effect.forEach(
      opened,
      ({ file, uri }) =>
        handle.connection.pullDiagnostics(uri).pipe(
          Effect.timeout(PULL_TIMEOUT),
          Effect.map((answer) => ({ answer, file, kind: "resolved" as const, uri })),
          Effect.catchTag("TimeoutError", () => Effect.succeed({ file, kind: "pending" as const })),
          Effect.catchTag("LspRequestError", (error) =>
            Effect.succeed({ file, kind: "failed" as const, message: error.message }),
          ),
        ),
      { concurrency: PULL_CONCURRENCY },
    );
    const map = yield* handle.connection.published;

    const collected: Collected = { diagnostics: [], failed: [], pending: [], resolved: [] };
    for (const outcome of outcomes) {
      if (outcome.kind === "pending") {
        collected.pending.push(outcome.file);
        continue;
      }
      if (outcome.kind === "failed") {
        collected.failed.push({ file: outcome.file, message: outcome.message });
        continue;
      }
      collected.resolved.push(outcome.file);
      const pushed = map.get(outcome.uri) ?? [];
      collected.diagnostics.push(...mapItems([...outcome.answer.items, ...pushed], outcome.uri));
      for (const [relatedUri, relatedItems] of outcome.answer.related) {
        collected.diagnostics.push(...mapItems(relatedItems, relatedUri));
      }
    }
    return collected;
  });
}

function collectDiagnostics(handle: ServerHandle, repoRoot: string, files: ChangedFile[]) {
  // Hoisted so the `ensuring` finalizer below closes every doc opened so far, keeping the per-uri
  // Refcount balanced even when a refresh interrupts the run or it fails mid-loop; a leaked open
  // Count would suppress every later didOpen for that uri (no republish, file stuck pending).
  const opened: { file: ChangedFile; uri: string }[] = [];
  return Effect.gen(function* collect() {
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
      yield* handle.connection.openDocument({
        languageId: lspLanguageId(file.path),
        text,
        uri,
        version: 1,
      });
      opened.push({ file, uri });
    }

    // A server that advertises pull answers request/response, no settle heuristics; every other
    // Server keeps the push path: wait for its publishes, then snapshot.
    if (handle.capabilities.has("pullDiagnostics")) {
      const collected = yield* pullDiagnostics(handle, opened);
      return { ...collected, pending: [...pending, ...collected.pending] } satisfies Collected;
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

    return { diagnostics, failed: [], pending, resolved } satisfies Collected;
  }).pipe(
    Effect.ensuring(
      Effect.forEach(opened, (entry) => handle.connection.closeDocument(entry.uri), {
        discard: true,
      }),
    ),
  );
}

type LanguageOutcome =
  | { kind: "diagnostics"; collected: Collected }
  | { kind: "degraded"; status: "failed" | "unavailable"; message: string }
  | { kind: "installing"; message: string };

const statusRank: Record<CheckerFileState["status"], number> = {
  clean: 2,
  failed: 1,
  findings: 4,
  pending: 3,
  unavailable: 0,
};

/**
 * Merge one file's state across the servers that handle it (typescript and oxlint overlap): union
 * the diagnostics, and let the strongest signal win (findings > pending > clean > failed >
 * unavailable). A degraded server thus never overrides another's real result, so a tsc-clean file
 * with oxlint absent stays clean rather than flipping to unavailable.
 */
function mergeFileState(a: CheckerFileState, b: CheckerFileState): CheckerFileState {
  const diagnostics = [...a.diagnostics, ...b.diagnostics];
  const winner = statusRank[b.status] > statusRank[a.status] ? b : a;
  return {
    count: diagnostics.length,
    diagnostics,
    status: winner.status,
    ...(winner.message === undefined ? {} : { message: winner.message }),
  };
}

function mergeStates(maps: Map<string, CheckerFileState>[]): Map<string, CheckerFileState> {
  const merged = new Map<string, CheckerFileState>();
  for (const map of maps) {
    for (const [path, fileState] of map) {
      const existing = merged.get(path);
      merged.set(path, existing === undefined ? fileState : mergeFileState(existing, fileState));
    }
  }
  return merged;
}

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
            message: `installing ${error.language} server…`,
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

    // One server's view of its files as a keyed state map: findings/clean from a resolved run,
    // Pending for cold/installing files, failed/unavailable when the server degraded.
    function stateForLanguage(repoRoot: string, language: string, langFiles: ChangedFile[]) {
      return runLanguage(repoRoot, language, langFiles).pipe(
        Effect.map((outcome) => {
          if (outcome.kind === "diagnostics") {
            const { diagnostics, failed, pending, resolved } = outcome.collected;
            const map = stateForResolvedChecker("diagnostics", resolved, diagnostics, repoRoot);
            // A pending/failed file may already carry findings from another file's related
            // Report; those are real results, so they win (findings outrank both, per statusRank).
            for (const file of pending) {
              if (map.get(file.path)?.status !== "findings") {
                map.set(file.path, { count: 0, diagnostics: [], status: "pending" });
              }
            }
            for (const { file, message } of failed) {
              if (map.get(file.path)?.status !== "findings") {
                map.set(file.path, { count: 0, diagnostics: [], message, status: "failed" });
              }
            }
            return map;
          }
          const status = outcome.kind === "installing" ? "pending" : outcome.status;
          const map = new Map<string, CheckerFileState>();
          for (const file of langFiles) {
            map.set(file.path, { count: 0, diagnostics: [], message: outcome.message, status });
          }
          return map;
        }),
      );
    }

    // Files no active server handles stay unavailable; nothing else reports them, so they survive the
    // Merge. A repo-gated server (Biome off in a non-Biome repo) doesn't count as a handler here.
    function noServerState(serversFor: (path: string) => string[], changed: ChangedFile[]) {
      const map = new Map<string, CheckerFileState>();
      for (const file of changed) {
        if (serversFor(file.path).length === 0) {
          map.set(file.path, {
            count: 0,
            diagnostics: [],
            message: "no language server for this file type",
            status: "unavailable",
          });
        }
      }
      return map;
    }

    // A coherent snapshot from the servers finished so far. Per changed file: a fast server's
    // Findings show immediately; once every applicable server has reported the result is definitive
    // (clean, or the pending a server that never published leaves); until then the file holds its
    // Prior badge (or pending on a cold start) rather than flickering to pending each re-run.
    function snapshot(
      serversFor: (path: string) => string[],
      changed: ChangedFile[],
      done: Set<string>,
      maps: Map<string, CheckerFileState>[],
      noServer: Map<string, CheckerFileState>,
      prior: ReadonlyMap<string, CheckerFileState> | undefined,
    ) {
      const merged = mergeStates(maps);
      const state = new Map<string, CheckerFileState>(noServer);
      for (const file of changed) {
        const languages = serversFor(file.path);
        if (languages.length === 0) {
          continue;
        }
        const fileState = merged.get(file.path);
        if (fileState?.status === "findings") {
          state.set(file.path, fileState);
        } else if (languages.every((language) => done.has(language))) {
          state.set(file.path, fileState ?? { count: 0, diagnostics: [], status: "clean" });
        } else {
          state.set(
            file.path,
            prior?.get(file.path) ?? { count: 0, diagnostics: [], status: "pending" },
          );
        }
      }
      // Cross-file findings: a server reports errors in files outside the changed set (SPEC retains
      // Findings for every reported path), so carry those through too.
      for (const [path, fileState] of merged) {
        if (!state.has(path) && fileState.status === "findings") {
          state.set(path, fileState);
        }
      }
      return state;
    }

    // A file resolves to every server that handles its extension (typescript and oxlint both claim
    // The JS/TS family), so it runs through each concurrently and emits a fresh merged snapshot as
    // Each server finishes, rather than waiting for the slowest before showing anything.
    function run(
      repoRoot: string,
      files: ChangedFile[],
      prior?: ReadonlyMap<string, CheckerFileState>,
    ) {
      const changed = files.filter((file) => file.kind !== "deleted");
      // Evaluate each server's repo gate once for this run, then reuse it per file (and per snapshot
      // Emission below) so a filesystem-stat gate like Biome's isn't re-checked for every file.
      const active = activeLanguages(repoRoot);
      const serversFor = (path: string) =>
        serversForPath(path).filter((language) => active.has(language));
      const noServer = noServerState(serversFor, changed);
      const languages = [...new Set(changed.flatMap((file) => serversFor(file.path)))];
      if (languages.length === 0) {
        return Stream.make({ checker: "diagnostics", state: noServer } satisfies CheckerUpdate);
      }

      const perLanguage = languages.map((language) =>
        Stream.fromEffect(
          // Each language self-scopes so it acquires/releases its own pooled server independently.
          Effect.scoped(
            stateForLanguage(
              repoRoot,
              language,
              changed.filter((file) => serversFor(file.path).includes(language)),
            ).pipe(Effect.map((map) => ({ language, map }))),
          ),
        ),
      );

      return Stream.mergeAll(perLanguage, { concurrency: "unbounded" }).pipe(
        Stream.scan(
          { done: new Set<string>(), maps: [] as Map<string, CheckerFileState>[] },
          (accumulator, next) => ({
            done: new Set(accumulator.done).add(next.language),
            maps: [...accumulator.maps, next.map],
          }),
        ),
        // Drop the empty seed scan emits before the first server finishes.
        Stream.drop(1),
        Stream.map(
          (accumulator) =>
            ({
              checker: "diagnostics",
              state: snapshot(
                serversFor,
                changed,
                accumulator.done,
                accumulator.maps,
                noServer,
                prior,
              ),
            }) satisfies CheckerUpdate,
        ),
      );
    }

    return { run };
  }),
);
