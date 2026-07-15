/**
 * JSON-RPC request/response correlation over an abstract message channel. A forked router fiber
 * drains inbound messages: responses resolve the matching pending request, server-to-client
 * requests get a minimal reply so the server never blocks, notifications are logged. Decoupled from
 * the process so it can be driven by a fake in-process peer in tests.
 */
import { Data, Deferred, Effect, Queue, Stream } from "effect";
import type { Cause } from "effect";

import { isJsonRpcNotification, isJsonRpcRequest, isJsonRpcResponse } from "./jsonrpc";
import type { JsonRpcMessage } from "./jsonrpc";
import {
  outOfTreeBases,
  parseWatcherRegistrations,
  parseWatcherUnregistrations,
  watchedFileChanges,
} from "./watched-files";
import type { WatchedPathChange, WatcherRegistration } from "./watched-files";

/**
 * Paths per synchronous slice while typing a watcher batch. Each path costs a stat (~6us measured),
 * so this bounds one uninterrupted pass to well under a 16ms frame; the fiber yields between
 * slices.
 */
const MATERIALIZE_CHUNK = 256;

export class LspRequestError extends Data.TaggedError("LspRequestError")<{
  readonly method: string;
  readonly message: string;
}> {}

export interface LspTransportChannel {
  readonly inbound: Queue.Dequeue<unknown, Cause.Done>;
  readonly send: (message: JsonRpcMessage) => Effect.Effect<void>;
}

interface TextDocument {
  readonly uri: string;
  readonly languageId: string;
  readonly text: string;
  readonly version: number;
}

/** One `textDocument/diagnostic` answer: the file's items plus any cross-file reports it carried. */
interface PulledDiagnostics {
  readonly items: unknown[];
  /** Full `relatedDocuments` reports keyed by uri; per-answer data, deliberately not stored. */
  readonly related: ReadonlyMap<string, unknown[]>;
}

export interface LspConnection {
  readonly request: (method: string, params?: unknown) => Effect.Effect<unknown, LspRequestError>;
  readonly notify: (method: string, params?: unknown) => Effect.Effect<void>;
  /**
   * One pull-diagnostics round trip for an open document, with `resultId` bookkeeping: the previous
   * answer's id rides along as `previousResultId`, and an `unchanged` report resolves to the items
   * cached from the last `full` one. The cache is the transport's because it must live exactly as
   * long as the connection: a fresh server knows no prior resultId, a warm one honors it.
   */
  readonly pullDiagnostics: (uri: string) => Effect.Effect<PulledDiagnostics, LspRequestError>;
  /**
   * Refcounted `textDocument/didOpen`: sent only on the first holder of a uri (count 0→1); a later
   * holder reuses the already-open doc. Intel pulls and the diagnostics run share one connection,
   * so this keeps a second open from resetting the server's view of a doc another holder still
   * needs.
   */
  readonly openDocument: (textDocument: TextDocument) => Effect.Effect<void>;
  /**
   * Full-text `textDocument/didChange` for an already-open document, versioned by a per-uri counter
   * the transport owns (seeded from the open's version, bumped per change), so callers never
   * coordinate versions. Full sync is deliberate: stet always holds the whole on-disk file, and a
   * full-replacement event is valid under both full and incremental server sync modes.
   */
  readonly changeDocument: (uri: string, text: string) => Effect.Effect<void>;
  /** Refcounted `textDocument/didClose`: sent only when the last holder of the uri releases (1→0). */
  readonly closeDocument: (uri: string) => Effect.Effect<void>;
  /** Latest server-pushed `publishDiagnostics` items, keyed by document URI. */
  readonly published: Effect.Effect<ReadonlyMap<string, unknown[]>>;
  /**
   * Drop stored diagnostics for the given URIs before reopening them, so a re-pull starts clean,
   * and open the **awaited window** on them: a publish that lands for an awaited URI is the server
   * answering what the run just sent, so it must not nudge a re-check (the run is already waiting
   * on it). `endPublishWait` closes the window once the run has read the bucket.
   */
  readonly clearPublished: (uris: readonly string[]) => Effect.Effect<void>;
  /**
   * Closes the awaited window `clearPublished` opened, at the point a run has finished reading the
   * bucket. From here any publish that changes a document's items is the server correcting itself
   * out of band (pyright re-analyzing after an async library reload once a dependency install
   * landed), which no run is waiting for and nothing else would re-render, so it nudges a
   * re-check.
   */
  readonly endPublishWait: Effect.Effect<void>;
  /**
   * Forward on-disk changes the server asked to hear about (`workspace/didChangeWatchedFiles`),
   * filtered against its own registered globs. Takes the raw batch, **untyped**, and matches before
   * it types: a server that registered nothing returns in O(1) without touching a path, so a
   * self-watching server (rust-analyzer, pinned to `files.watcher: server`) costs nothing at all.
   * `root` is what the paths are relative to (the worktree, or an out-of-tree registered base).
   */
  readonly watchedFilesChanged: (
    root: string,
    changes: readonly WatchedPathChange[],
    isTracked: (path: string) => boolean,
  ) => Effect.Effect<void>;
  /**
   * The out-of-worktree directories this server asked to watch, re-emitted whenever its
   * registrations change. A stream rather than a getter because registrations arrive
   * asynchronously, after the handshake. stet's worktree watcher cannot see these (pyright names a
   * conda/pyenv venv living outside the repo), so each base needs a watch of its own.
   */
  readonly watchedBases: Stream.Stream<readonly string[]>;
  /** True once the server's stdout closed — the child died; the pool should rebuild it. */
  readonly closed: Effect.Effect<boolean>;
  /**
   * Resolves once the server has finished loading its project (the first `$/progress` "end" after
   * `initialize`), or immediately when already loaded. Until then a server like
   * typescript-language-server answers `textDocument/definition` from the local import binding
   * instead of resolving cross-file, so intel pulls await this before requesting. Also resolves on
   * connection close so a pull never hangs past server death.
   */
  readonly whenProjectLoaded: Effect.Effect<void>;
}

interface Pending {
  readonly deferred: Deferred.Deferred<unknown, LspRequestError>;
  readonly method: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

interface ParsedReport {
  readonly kind: "full" | "unchanged";
  readonly resultId?: string;
  readonly items: unknown[];
  readonly related: Map<string, unknown[]>;
}

// A DocumentDiagnosticReport: `full` carries items (and the resultId to send back next time),
// `unchanged` asserts the previous resultId still holds. `relatedDocuments` nests one report per
// Cross-file uri; only its `full` entries carry data, and the spec nests no further level.
function parseDiagnosticReport(value: unknown): ParsedReport | undefined {
  if (!isObject(value)) {
    return undefined;
  }
  const resultId = typeof value.resultId === "string" ? { resultId: value.resultId } : {};
  const related = new Map<string, unknown[]>();
  if (isObject(value.relatedDocuments)) {
    for (const [uri, report] of Object.entries(value.relatedDocuments)) {
      if (isObject(report) && report.kind === "full" && Array.isArray(report.items)) {
        related.set(uri, report.items);
      }
    }
  }
  if (value.kind === "full" && Array.isArray(value.items)) {
    return { items: value.items, kind: "full", related, ...resultId };
  }
  if (value.kind === "unchanged") {
    return { items: [], kind: "unchanged", related, ...resultId };
  }
  return undefined;
}

/**
 * Creates an LSP connection over the supplied message transport.
 *
 * @param channel - The inbound and outbound JSON-RPC message transport
 * @param repoRoot - The repository root used to resolve watched-file registrations
 * @param onRequest - Handles server-to-client requests that are not handled internally
 * @param onRecheck - Runs when the server requests refreshed diagnostics
 * @returns The LSP connection API
 */
export function makeTransport(
  channel: LspTransportChannel,
  repoRoot: string,
  onRequest?: (method: string, params: unknown) => Effect.Effect<unknown>,
  onRecheck?: Effect.Effect<void>,
) {
  return Effect.gen(function* makeTransportScope() {
    // Default answer for a server-to-client request: a null result, so a server that asks for
    // Something we do not model (typescript) never stalls. oxlint supplies a real handler.
    const respond = onRequest ?? (() => Effect.succeed(null));
    const pending = new Map<number, Pending>();
    const published = new Map<string, unknown[]>();
    const openCounts = new Map<string, number>();
    // The globs this server registered, by registration id, and the URIs a run is currently awaiting
    // A publish for (see `clearPublished`/`endPublishWait`).
    const registrations = new Map<string, WatcherRegistration>();
    const awaiting = new Set<string>();
    const baseUpdates = yield* Queue.unbounded<readonly string[]>();
    // Announce only a base list that actually moved. The consumer re-keys its watchers with
    // `switchMap`, so a redundant emission tears every `fs.watch` handle down and rebuilds it,
    // Losing whatever lands in the gap. A server that re-registers on a config change (pyright does)
    // Would otherwise churn its watchers for nothing.
    let announced: readonly string[] = [];
    const announceBases = Effect.suspend(() => {
      const next = outOfTreeBases([...registrations.values()], repoRoot);
      if (next.length === announced.length && next.every((base, i) => base === announced[i])) {
        return Effect.void;
      }
      announced = next;
      return Queue.offer(baseUpdates, next).pipe(Effect.asVoid);
    });
    let nextId = 0;
    let closed = false;
    // Resolved on the first project-load `$/progress` "end" (or on close); `whenProjectLoaded`
    // Gates intel pulls so a request never lands during the load window with a premature reply.
    let loaded = false;
    const projectLoaded = yield* Deferred.make<void>();
    const markLoaded = Effect.suspend(() => {
      if (loaded) {
        return Effect.void;
      }
      loaded = true;
      return Deferred.succeed(projectLoaded, undefined).pipe(Effect.asVoid);
    });

    function dispatch(message: unknown) {
      if (isJsonRpcResponse(message)) {
        if (typeof message.id !== "number") {
          return Effect.void;
        }
        const entry = pending.get(message.id);
        if (entry === undefined) {
          return Effect.void;
        }
        pending.delete(message.id);
        return message.error === undefined
          ? Deferred.succeed(entry.deferred, message.result)
          : Deferred.fail(
              entry.deferred,
              new LspRequestError({ message: message.error.message, method: entry.method }),
            );
      }
      if (isJsonRpcRequest(message)) {
        const { id } = message;
        // A server nudging "re-pull your diagnostics" (rust-analyzer after a cargo check cycle):
        // Answer immediately so it never stalls, then surface the nudge so the app re-runs checks.
        if (message.method === "workspace/diagnostic/refresh") {
          return channel
            .send({ id, jsonrpc: "2.0", result: null })
            .pipe(Effect.andThen(onRecheck ?? Effect.void));
        }
        // The server declaring which on-disk paths it needs to hear about. Honoring this is the
        // Whole point: basedpyright does no filesystem watching of its own, so these globs are the
        // Only thing that lets it learn a dependency was installed. Answer immediately either way,
        // Then re-announce the bases so the pool can watch any that fall outside the worktree.
        if (message.method === "client/registerCapability") {
          const added = parseWatcherRegistrations(message.params, repoRoot);
          for (const registration of added) {
            registrations.set(registration.id, registration);
          }
          return channel
            .send({ id, jsonrpc: "2.0", result: null })
            .pipe(Effect.andThen(added.length === 0 ? Effect.void : announceBases));
        }
        if (message.method === "client/unregisterCapability") {
          const removed = parseWatcherUnregistrations(message.params);
          for (const registrationId of removed) {
            registrations.delete(registrationId);
          }
          return channel
            .send({ id, jsonrpc: "2.0", result: null })
            .pipe(Effect.andThen(removed.length === 0 ? Effect.void : announceBases));
        }
        // Answer other server-to-client requests so the server does not stall waiting on us; the
        // Handler (or the null default) decides the result.
        return respond(message.method, message.params).pipe(
          Effect.flatMap((result) => channel.send({ id, jsonrpc: "2.0", result })),
        );
      }
      if (isJsonRpcNotification(message)) {
        if (message.method === "textDocument/publishDiagnostics" && isObject(message.params)) {
          const { diagnostics, uri } = message.params;
          if (typeof uri !== "string" || !Array.isArray(diagnostics)) {
            return Effect.void;
          }
          const previous = published.get(uri);
          published.set(uri, diagnostics);
          // "No entry" is not the same as "an empty entry". A run that capped out its settle cleared
          // The bucket and never got an answer, leaving the file `pending`; the server's late reply
          // Is that answer, and it is news even when it is clean. Treating an absent entry as an
          // Empty one swallowed exactly that, stranding the file pending until the next git activity.
          const unchanged = previous !== undefined && Bun.deepEquals(previous, diagnostics);
          // Inside the awaited window this publish is the answer to what the run just sent, and that
          // Run will read it, so it is not news. Outside it, a server that changed its mind on its
          // Own is the only thing that produces this, and no run is waiting for it: without the
          // Nudge, pyright's post-install re-analysis lands in the bucket and is never rendered.
          if (awaiting.has(uri) || unchanged) {
            return Effect.void;
          }
          return onRecheck ?? Effect.void;
        }
        // A workDoneProgress "end" marks the project load complete; before it, intel replies are
        // Resolved from the local import binding rather than cross-file (the F12-stops-at-import bug).
        if (message.method === "$/progress" && isObject(message.params)) {
          const { value } = message.params;
          return isObject(value) && value.kind === "end" ? markLoaded : Effect.void;
        }
        return Effect.logDebug(`lsp notification ${message.method}`);
      }
      return Effect.void;
    }

    // The router stops when the inbound queue ends or fails (the connection closed); fail every
    // Still-pending request so a caller awaiting a reply is released rather than hanging forever.
    const router = Queue.take(channel.inbound).pipe(
      Effect.flatMap(dispatch),
      Effect.forever,
      Effect.catchCause(() =>
        Effect.sync(() => {
          closed = true;
        }).pipe(
          // Release any pull awaiting project load so it fails fast instead of hanging past death.
          Effect.andThen(markLoaded),
          Effect.andThen(
            Effect.forEach(
              [...pending.values()],
              (entry) =>
                Deferred.fail(
                  entry.deferred,
                  new LspRequestError({ message: "connection closed", method: entry.method }),
                ),
              { discard: true },
            ),
          ),
        ),
      ),
    );
    yield* Effect.forkScoped(router);

    const request = (method: string, params?: unknown) =>
      Deferred.make<unknown, LspRequestError>().pipe(
        Effect.flatMap((deferred) => {
          const id = nextId;
          nextId += 1;
          pending.set(id, { deferred, method });
          return channel
            .send({ id, jsonrpc: "2.0", method, params })
            .pipe(
              Effect.andThen(Deferred.await(deferred)),
              Effect.ensuring(Effect.sync(() => pending.delete(id))),
            );
        }),
      );

    const notify = (method: string, params?: unknown) =>
      channel.send({ jsonrpc: "2.0", method, params });

    // The pull bucket: per uri, the last full report's items and the resultId to echo back. Only
    // Documents this client pulls enter it, so it stays bounded by the changed set. Commits need no
    // Per-uri ordering: each run renders from its own answers (the bucket only feeds the next
    // `previousResultId`), every commit is an atomic (resultId, items) pair the server itself
    // Issued, and echoing an older pair at worst makes the server answer `full` (an `unchanged` is
    // The server asserting the held pair is still current, so its reuse is correct by definition).
    const pulled = new Map<string, { resultId?: string; items: unknown[] }>();

    const pullDiagnostics = (uri: string) =>
      Effect.suspend(() => {
        const previous = pulled.get(uri);
        return request("textDocument/diagnostic", {
          textDocument: { uri },
          ...(previous?.resultId === undefined ? {} : { previousResultId: previous.resultId }),
        }).pipe(
          Effect.flatMap((result) => {
            const report = parseDiagnosticReport(result);
            if (report === undefined) {
              return Effect.fail(
                new LspRequestError({
                  message: "malformed diagnostic report",
                  method: "textDocument/diagnostic",
                }),
              );
            }
            const items = report.kind === "full" ? report.items : (previous?.items ?? []);
            // An `unchanged` without the (spec-required) resultId keeps the stored one; a `full`
            // Without one means the server issues no ids, so none is stored.
            const resultId =
              report.kind === "full" ? report.resultId : (report.resultId ?? previous?.resultId);
            pulled.set(uri, { items, ...(resultId === undefined ? {} : { resultId }) });
            return Effect.succeed({ items, related: report.related } satisfies PulledDiagnostics);
          }),
        );
      });

    // Per-uri document versions, seeded by the open's version and bumped per change. Never reset on
    // Close: LSP only requires versions to increase within an open session, and staying monotonic
    // For the connection's lifetime satisfies that for every reopen with no bookkeeping.
    const versions = new Map<string, number>();

    // The count is read-modified-written synchronously inside `suspend`, before the async send, so a
    // Second fiber acquiring the same uri can't interleave between the read and the increment.
    const openDocument = (textDocument: TextDocument) =>
      Effect.suspend(() => {
        const count = openCounts.get(textDocument.uri) ?? 0;
        openCounts.set(textDocument.uri, count + 1);
        if (count > 0) {
          return Effect.void;
        }
        const version = Math.max(textDocument.version, (versions.get(textDocument.uri) ?? 0) + 1);
        versions.set(textDocument.uri, version);
        return notify("textDocument/didOpen", { textDocument: { ...textDocument, version } });
      });

    const changeDocument = (uri: string, text: string) =>
      Effect.suspend(() => {
        const version = (versions.get(uri) ?? 0) + 1;
        versions.set(uri, version);
        return notify("textDocument/didChange", {
          contentChanges: [{ text }],
          textDocument: { uri, version },
        });
      });

    const closeDocument = (uri: string) =>
      Effect.suspend(() => {
        const count = openCounts.get(uri) ?? 0;
        if (count > 1) {
          openCounts.set(uri, count - 1);
          return Effect.void;
        }
        openCounts.delete(uri);
        return count === 1
          ? notify("textDocument/didClose", { textDocument: { uri } })
          : Effect.void;
      });

    return {
      changeDocument,
      clearPublished: (uris: readonly string[]) =>
        Effect.sync(() => {
          for (const uri of uris) {
            published.delete(uri);
            awaiting.add(uri);
          }
        }),
      closeDocument,
      closed: Effect.sync(() => closed),
      endPublishWait: Effect.sync(() => awaiting.clear()),
      notify,
      openDocument,
      published: Effect.sync(() => published),
      pullDiagnostics,
      request,
      watchedBases: Stream.fromQueue(baseUpdates),
      watchedFilesChanged: (
        root: string,
        changes: readonly WatchedPathChange[],
        isTracked: (path: string) => boolean,
      ) =>
        Effect.suspend(() => {
          // The early-out, before a single path is touched. A server that registered nothing is sent
          // Nothing, and after rust-analyzer's `files.watcher: server` pin that is every built-in but
          // Basedpyright, so in a JS/TS or Rust repo this whole channel costs one map lookup per
          // Batch. It has to come first: an install's batch is tens of thousands of paths and typing
          // Even one of them is a stat (see `watchedFileChanges`).
          if (registrations.size === 0 || changes.length === 0) {
            return Effect.void;
          }
          const registered = [...registrations.values()];
          // Slice the batch and yield between slices. pyright registers `**`, so in a Python repo
          // Every path an install writes really is claimed and really must be stat'd; doing that in
          // One synchronous pass is a multi-hundred-millisecond hole in the render loop. Chunking
          // Keeps each pass well under a frame and hands the loop back in between, so the batch costs
          // Latency instead of dropped frames, and no event is dropped to buy that.
          return Effect.forEach(
            Array.from({ length: Math.ceil(changes.length / MATERIALIZE_CHUNK) }, (_, index) =>
              changes.slice(index * MATERIALIZE_CHUNK, (index + 1) * MATERIALIZE_CHUNK),
            ),
            (slice) =>
              Effect.sync(() => watchedFileChanges(registered, root, slice, isTracked)).pipe(
                Effect.tap(() => Effect.yieldNow),
              ),
            { concurrency: 1 },
          ).pipe(
            Effect.flatMap((slices) => {
              const events = slices.flat();
              return events.length === 0
                ? Effect.void
                : notify("workspace/didChangeWatchedFiles", { changes: events });
            }),
          );
        }),
      whenProjectLoaded: Effect.suspend(() =>
        loaded ? Effect.void : Deferred.await(projectLoaded),
      ),
    } satisfies LspConnection;
  });
}
