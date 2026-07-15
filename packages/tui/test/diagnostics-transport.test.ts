import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";

import { Effect, Exit, Option, Queue, Stream } from "effect";
import type { Cause } from "effect";

import { isJsonRpcNotification, isJsonRpcRequest, isJsonRpcResponse } from "@/diagnostics/jsonrpc";
import type { JsonRpcMessage } from "@/diagnostics/jsonrpc";
import { makeTransport } from "@/diagnostics/transport";
import type { LspConnection } from "@/diagnostics/transport";

// A real directory: forwarding a watched change types it by reading the disk, since `fs.watch` calls
// Both an appearance and a vanishing a "rename" and only presence tells them apart.
const REPO = mkdtempSync(join(tmpdir(), "stet-transport-"));

afterAll(() => rmSync(REPO, { force: true, recursive: true }));

interface Peer {
  connection: LspConnection;
  /** Messages the client wrote outbound. */
  sent: Queue.Dequeue<JsonRpcMessage, Cause.Done>;
  /** Push a message back onto the inbound channel, as a real server would. */
  reply: (message: JsonRpcMessage) => Effect.Effect<void>;
  /** Close the inbound channel, simulating the server going away. */
  close: Effect.Effect<void>;
}

/** Drives the transport against a fake in-process peer over two queues. No process, no mocks. */
function withPeer<A, E>(
  run: (peer: Peer) => Effect.Effect<A, E>,
  onRefreshRequest?: Effect.Effect<void>,
) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* fakePeer() {
        const inbound = yield* Queue.make<unknown, Cause.Done>();
        const sent = yield* Queue.make<JsonRpcMessage, Cause.Done>();
        const connection = yield* makeTransport(
          {
            inbound,
            send: (message) => Queue.offer(sent, message).pipe(Effect.asVoid),
          },
          REPO,
          undefined,
          onRefreshRequest,
        );
        return yield* run({
          close: Queue.end(inbound).pipe(Effect.asVoid),
          connection,
          reply: (message) => Queue.offer(inbound, message).pipe(Effect.asVoid),
          sent,
        });
      }),
    ),
  );
}

function idOf(message: JsonRpcMessage) {
  return isJsonRpcRequest(message) ? message.id : 0;
}

const doc = (uri: string) => ({ languageId: "typescript", text: "x", uri, version: 1 });

/** Drain every notification the client has written so far and return them, in order. */
function sentNotifications(sent: Queue.Dequeue<JsonRpcMessage, Cause.Done>) {
  return Queue.takeAll(sent).pipe(Effect.map((messages) => messages.filter(isJsonRpcNotification)));
}

test("didOpen is sent only for the first holder of a uri", async () => {
  const methods = await withPeer(({ connection, sent }) =>
    connection.openDocument(doc("file:///a.ts")).pipe(
      Effect.andThen(connection.openDocument(doc("file:///a.ts"))),
      Effect.andThen(sentNotifications(sent)),
      Effect.map((notifications) => notifications.map((message) => message.method)),
    ),
  );
  expect(methods).toEqual(["textDocument/didOpen"]);
});

test("didClose is sent only when the last holder of a uri releases", async () => {
  const methods = await withPeer(({ connection, sent }) =>
    connection.openDocument(doc("file:///a.ts")).pipe(
      Effect.andThen(connection.openDocument(doc("file:///a.ts"))),
      Effect.andThen(connection.closeDocument("file:///a.ts")),
      Effect.andThen(connection.closeDocument("file:///a.ts")),
      Effect.andThen(sentNotifications(sent)),
      Effect.map((notifications) => notifications.map((message) => message.method)),
    ),
  );
  expect(methods).toEqual(["textDocument/didOpen", "textDocument/didClose"]);
});

test("distinct uris are refcounted independently", async () => {
  const notifications = await withPeer(({ connection, sent }) =>
    connection
      .openDocument(doc("file:///a.ts"))
      .pipe(
        Effect.andThen(connection.openDocument(doc("file:///b.ts"))),
        Effect.andThen(connection.closeDocument("file:///a.ts")),
        Effect.andThen(sentNotifications(sent)),
      ),
  );
  // A opens, b opens, a closes while b stays open.
  expect(notifications).toMatchObject([
    { method: "textDocument/didOpen", params: { textDocument: { uri: "file:///a.ts" } } },
    { method: "textDocument/didOpen", params: { textDocument: { uri: "file:///b.ts" } } },
    { method: "textDocument/didClose", params: { textDocument: { uri: "file:///a.ts" } } },
  ]);
});

test("a uri reopened after a full release sends a fresh didOpen", async () => {
  const methods = await withPeer(({ connection, sent }) =>
    connection.openDocument(doc("file:///a.ts")).pipe(
      Effect.andThen(connection.closeDocument("file:///a.ts")),
      Effect.andThen(connection.openDocument(doc("file:///a.ts"))),
      Effect.andThen(sentNotifications(sent)),
      Effect.map((notifications) => notifications.map((message) => message.method)),
    ),
  );
  expect(methods).toEqual([
    "textDocument/didOpen",
    "textDocument/didClose",
    "textDocument/didOpen",
  ]);
});

test("request resolves with the result of the matching response", async () => {
  const exit = await withPeer(({ connection, reply, sent }) =>
    Effect.all(
      [
        Effect.exit(connection.request("initialize", { root: "/" })),
        Effect.gen(function* respond() {
          const outgoing = yield* Queue.take(sent);
          expect(outgoing).toMatchObject({ method: "initialize", params: { root: "/" } });
          yield* reply({ id: idOf(outgoing), jsonrpc: "2.0", result: { ok: true } });
        }),
      ],
      { concurrency: "unbounded" },
    ).pipe(Effect.map(([result]) => result)),
  );
  expect(exit).toMatchObject({ _tag: "Success", value: { ok: true } });
});

test("request fails when the response carries an error", async () => {
  const exit = await withPeer(({ connection, reply, sent }) =>
    Effect.all(
      [
        Effect.exit(connection.request("textDocument/diagnostic")),
        Effect.gen(function* respond() {
          const outgoing = yield* Queue.take(sent);
          yield* reply({
            error: { code: -32_000, message: "boom" },
            id: idOf(outgoing),
            jsonrpc: "2.0",
          });
        }),
      ],
      { concurrency: "unbounded" },
    ).pipe(Effect.map(([result]) => result)),
  );
  expect(Exit.isFailure(exit)).toBe(true);
});

test("correlates concurrent requests by id, regardless of reply order", async () => {
  const results = await withPeer(({ connection, reply, sent }) =>
    Effect.all(
      [
        Effect.exit(connection.request("a")),
        Effect.exit(connection.request("b")),
        Effect.gen(function* respond() {
          const out1 = yield* Queue.take(sent);
          const out2 = yield* Queue.take(sent);
          // Reply to the second request first to prove correlation is by id, not arrival order.
          yield* reply({ id: idOf(out2), jsonrpc: "2.0", result: "B" });
          yield* reply({ id: idOf(out1), jsonrpc: "2.0", result: "A" });
        }),
      ],
      { concurrency: "unbounded" },
    ).pipe(Effect.map(([a, b]) => ({ a, b }))),
  );
  expect(results.a).toMatchObject({ value: "A" });
  expect(results.b).toMatchObject({ value: "B" });
});

test("answers a server-to-client request with a null result", async () => {
  const echoed = await withPeer(({ reply, sent }) =>
    Effect.gen(function* scenario() {
      yield* reply({ id: 99, jsonrpc: "2.0", method: "window/workDoneProgress/create" });
      return yield* Queue.take(sent);
    }),
  );
  expect(echoed).toEqual({ id: 99, jsonrpc: "2.0", result: null });
});

test("answers a server-to-client request with the supplied handler's result", async () => {
  const echoed = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* scenario() {
        const inbound = yield* Queue.make<unknown, Cause.Done>();
        const sent = yield* Queue.make<JsonRpcMessage, Cause.Done>();
        // Oxlint answers `workspace/configuration` with its options, or it never publishes.
        yield* makeTransport(
          { inbound, send: (message) => Queue.offer(sent, message).pipe(Effect.asVoid) },
          REPO,
          (method) =>
            Effect.succeed(method === "workspace/configuration" ? [{ run: "onType" }] : null),
        );
        yield* Queue.offer(inbound, {
          id: 7,
          jsonrpc: "2.0",
          method: "workspace/configuration",
          params: { items: [{}] },
        });
        return yield* Queue.take(sent);
      }),
    ),
  );
  expect(echoed).toEqual({ id: 7, jsonrpc: "2.0", result: [{ run: "onType" }] });
});

test("whenProjectLoaded stays pending until the project-load progress ends", async () => {
  const phases = await withPeer(({ connection, reply }) =>
    Effect.gen(function* scenario() {
      const probe = connection.whenProjectLoaded.pipe(
        Effect.as("loaded"),
        Effect.timeout("30 millis"),
        Effect.catchTag("TimeoutError", () => Effect.succeed("pending")),
      );
      // No progress yet: still loading, so the gate holds.
      const before = yield* probe;
      yield* reply({
        jsonrpc: "2.0",
        method: "$/progress",
        params: {
          token: "t",
          value: { kind: "begin", title: "Initializing JS/TS language features…" },
        },
      });
      // A "begin" alone must not open the gate.
      const during = yield* probe;
      yield* reply({
        jsonrpc: "2.0",
        method: "$/progress",
        params: { token: "t", value: { kind: "end" } },
      });
      const after = yield* connection.whenProjectLoaded.pipe(
        Effect.as("loaded"),
        Effect.timeout("1 second"),
        Effect.catchTag("TimeoutError", () => Effect.succeed("pending")),
      );
      return { after, before, during };
    }),
  );
  expect(phases).toEqual({ after: "loaded", before: "pending", during: "pending" });
});

test("whenProjectLoaded resolves when the connection closes", async () => {
  const phase = await withPeer(({ close, connection }) =>
    close.pipe(
      Effect.andThen(connection.whenProjectLoaded),
      Effect.as("loaded"),
      Effect.timeout("1 second"),
      Effect.catchTag("TimeoutError", () => Effect.succeed("pending")),
    ),
  );
  expect(phase).toBe("loaded");
});

test("a closed connection fails an in-flight request instead of hanging", async () => {
  const exit = await withPeer(({ close, connection, sent }) =>
    Effect.all(
      [
        Effect.exit(connection.request("initialize")),
        Effect.gen(function* shutDown() {
          yield* Queue.take(sent);
          yield* close;
        }),
      ],
      { concurrency: "unbounded" },
    ).pipe(Effect.map(([result]) => result)),
  );
  expect(Exit.isFailure(exit)).toBe(true);
});

test("pullDiagnostics echoes the stored resultId and reuses cached items on unchanged", async () => {
  const outcome = await withPeer(({ connection, reply, sent }) =>
    Effect.all(
      [
        Effect.gen(function* pulls() {
          const first = yield* connection.pullDiagnostics("file:///a.ts");
          const second = yield* connection.pullDiagnostics("file:///a.ts");
          return { first, second };
        }),
        Effect.gen(function* respond() {
          const out1 = yield* Queue.take(sent);
          expect(isJsonRpcRequest(out1) ? out1.method : undefined).toBe("textDocument/diagnostic");
          // The first pull carries no previousResultId: nothing has been answered yet.
          expect(isJsonRpcRequest(out1) ? out1.params : undefined).toEqual({
            textDocument: { uri: "file:///a.ts" },
          });
          yield* reply({
            id: idOf(out1),
            jsonrpc: "2.0",
            result: { items: ["d1"], kind: "full", resultId: "r1" },
          });
          const out2 = yield* Queue.take(sent);
          // The second pull echoes the first answer's resultId back.
          expect(isJsonRpcRequest(out2) ? out2.params : undefined).toEqual({
            previousResultId: "r1",
            textDocument: { uri: "file:///a.ts" },
          });
          yield* reply({
            id: idOf(out2),
            jsonrpc: "2.0",
            result: { kind: "unchanged", resultId: "r2" },
          });
        }),
      ],
      { concurrency: "unbounded" },
    ).pipe(Effect.map(([pulls]) => pulls)),
  );
  expect(outcome.first.items).toEqual(["d1"]);
  // Unchanged means "same as the last full answer": the cached items resolve, not an empty set.
  expect(outcome.second.items).toEqual(["d1"]);
});

test("pullDiagnostics surfaces full relatedDocuments reports, skipping unchanged ones", async () => {
  const answer = await withPeer(({ connection, reply, sent }) =>
    Effect.all(
      [
        connection.pullDiagnostics("file:///a.ts"),
        Effect.gen(function* respond() {
          const outgoing = yield* Queue.take(sent);
          yield* reply({
            id: idOf(outgoing),
            jsonrpc: "2.0",
            result: {
              items: [],
              kind: "full",
              relatedDocuments: {
                "file:///b.ts": { items: ["cross"], kind: "full" },
                "file:///c.ts": { kind: "unchanged", resultId: "x" },
              },
              resultId: "r1",
            },
          });
        }),
      ],
      { concurrency: "unbounded" },
    ).pipe(Effect.map(([pulled]) => pulled)),
  );
  expect([...answer.related.entries()]).toEqual([["file:///b.ts", ["cross"]]]);
});

test("pullDiagnostics fails on a malformed diagnostic report", async () => {
  const exit = await withPeer(({ connection, reply, sent }) =>
    Effect.all(
      [
        Effect.exit(connection.pullDiagnostics("file:///a.ts")),
        Effect.gen(function* respond() {
          const outgoing = yield* Queue.take(sent);
          yield* reply({ id: idOf(outgoing), jsonrpc: "2.0", result: { nonsense: true } });
        }),
      ],
      { concurrency: "unbounded" },
    ).pipe(Effect.map(([result]) => result)),
  );
  expect(Exit.isFailure(exit)).toBe(true);
});

test("workspace/diagnostic/refresh is answered null and surfaces the nudge", async () => {
  let refreshes = 0;
  const response = await withPeer(
    ({ reply, sent }) =>
      Effect.gen(function* run() {
        yield* reply({ id: 7, jsonrpc: "2.0", method: "workspace/diagnostic/refresh" });
        return yield* Queue.take(sent);
      }),
    Effect.sync(() => {
      refreshes += 1;
    }),
  );
  expect(response).toMatchObject({ id: 7, result: null });
  expect(refreshes).toBe(1);
});

test("changeDocument sends the full text with a version that keeps increasing per uri", async () => {
  const notifications = await withPeer(({ connection, sent }) =>
    connection
      .openDocument(doc("file:///a.ts"))
      .pipe(
        Effect.andThen(connection.changeDocument("file:///a.ts", "const a = 2\n")),
        Effect.andThen(connection.changeDocument("file:///a.ts", "const a = 3\n")),
        Effect.andThen(connection.openDocument(doc("file:///b.ts"))),
        Effect.andThen(connection.changeDocument("file:///b.ts", "const b = 2\n")),
        Effect.andThen(sentNotifications(sent)),
      ),
  );
  expect(notifications).toMatchObject([
    {
      method: "textDocument/didOpen",
      params: { textDocument: { uri: "file:///a.ts", version: 1 } },
    },
    {
      method: "textDocument/didChange",
      params: {
        contentChanges: [{ text: "const a = 2\n" }],
        textDocument: { uri: "file:///a.ts", version: 2 },
      },
    },
    {
      method: "textDocument/didChange",
      params: {
        contentChanges: [{ text: "const a = 3\n" }],
        textDocument: { uri: "file:///a.ts", version: 3 },
      },
    },
    {
      method: "textDocument/didOpen",
      params: { textDocument: { uri: "file:///b.ts", version: 1 } },
    },
    {
      method: "textDocument/didChange",
      params: { textDocument: { uri: "file:///b.ts", version: 2 } },
    },
  ]);
});

test("a reopened document's version never regresses", async () => {
  const notifications = await withPeer(({ connection, sent }) =>
    connection
      .openDocument(doc("file:///a.ts"))
      .pipe(
        Effect.andThen(connection.changeDocument("file:///a.ts", "x")),
        Effect.andThen(connection.closeDocument("file:///a.ts")),
        Effect.andThen(connection.openDocument(doc("file:///a.ts"))),
        Effect.andThen(sentNotifications(sent)),
      ),
  );
  // The reopen's version continues past the closed session's (LSP only needs increase, and
  // Monotonic-for-the-connection means no bookkeeping can ever send a regressing version).
  expect(notifications).toMatchObject([
    { method: "textDocument/didOpen", params: { textDocument: { version: 1 } } },
    { method: "textDocument/didChange", params: { textDocument: { version: 2 } } },
    { method: "textDocument/didClose" },
    { method: "textDocument/didOpen", params: { textDocument: { version: 3 } } },
  ]);
});

// The router drains inbound in order, so once its answer to this request is out, every notification
// Replied before it has already been dispatched. `Queue.takeAll` blocks on an empty queue, so a test
// Asserting that nothing was sent needs this barrier rather than a bare drain.
const BARRIER_ID = 999;

function drainToBarrier(peer: Peer, collected: JsonRpcMessage[]): Effect.Effect<JsonRpcMessage[]> {
  return Queue.take(peer.sent).pipe(
    Effect.flatMap((message) =>
      isJsonRpcResponse(message) && message.id === BARRIER_ID
        ? Effect.succeed(collected)
        : drainToBarrier(peer, [...collected, message]),
    ),
    Effect.orDie,
  );
}

function notificationsSent(peer: Peer) {
  return peer.reply({ id: BARRIER_ID, jsonrpc: "2.0", method: "window/showMessageRequest" }).pipe(
    Effect.andThen(drainToBarrier(peer, [])),
    Effect.map((messages) => messages.filter(isJsonRpcNotification)),
  );
}

// The registration basedpyright sends once the client advertises `dynamicRegistration`: a catch-all
// Over the workspace, plus one `RelativePattern` per Python search path (a venv outside the repo).
/** Git's view of the path, the tiebreak that separates an atomic save from a genuine appearance. */
const NOT_TRACKED = () => false;

const watchRegistration = (searchPath?: string) => ({
  id: 1,
  jsonrpc: "2.0" as const,
  method: "client/registerCapability",
  params: {
    registrations: [
      {
        id: "watch",
        method: "workspace/didChangeWatchedFiles",
        registerOptions: {
          watchers: [
            { globPattern: "**" },
            ...(searchPath === undefined
              ? []
              : [{ globPattern: { baseUri: pathToFileURL(searchPath).href, pattern: "**" } }]),
          ],
        },
      },
    ],
  },
});

const publish = (uri: string, diagnostics: unknown[]) => ({
  jsonrpc: "2.0" as const,
  method: "textDocument/publishDiagnostics",
  params: { diagnostics, uri },
});

test("a registered server is told about a package installed into the venv", async () => {
  const installed = join(".venv", "lib", "site-packages", "fastapi", "__init__.py");
  mkdirSync(join(REPO, ".venv", "lib", "site-packages", "fastapi"), { recursive: true });
  writeFileSync(join(REPO, installed), "x\n");

  const [answer, notifications] = await withPeer((peer) =>
    Effect.gen(function* run() {
      yield* peer.reply(watchRegistration());
      const response = yield* Queue.take(peer.sent);
      yield* peer.connection.watchedFilesChanged(
        REPO,
        [
          { path: installed, renamed: true },
          { path: join("..", "outside", "the", "repo.py"), renamed: true },
        ],
        NOT_TRACKED,
      );
      return [response, yield* notificationsSent(peer)] as const;
    }),
  );

  // Answered immediately, so a server that blocks on its registration never stalls.
  expect(answer).toMatchObject({ id: 1, result: null });
  expect(notifications).toEqual([
    {
      jsonrpc: "2.0",
      method: "workspace/didChangeWatchedFiles",
      // The package that just landed is a Create, which is the only thing that makes pyright rescan
      // Its search paths; the path outside the worktree matched no glob, so it was not forwarded.
      params: { changes: [{ type: 1, uri: pathToFileURL(join(REPO, installed)).href }] },
    },
  ]);
});

test("a server that registered nothing is never sent watched-file changes", async () => {
  // Rust-analyzer, pinned to `files.watcher: server`, registers no globs and keeps watching itself.
  // It must also cost nothing: with no registrations the batch returns before a path is even typed,
  // Which is what keeps an install's tens of thousands of writes off the render thread.
  const notifications = await withPeer((peer) =>
    peer.connection
      .watchedFilesChanged(REPO, [{ path: join("src", "main.rs"), renamed: true }], NOT_TRACKED)
      .pipe(Effect.andThen(notificationsSent(peer))),
  );

  expect(notifications).toEqual([]);
});

test("unregistering drops the globs, so nothing is forwarded after it", async () => {
  const notifications = await withPeer((peer) =>
    Effect.gen(function* run() {
      yield* peer.reply(watchRegistration());
      yield* Queue.take(peer.sent);
      yield* peer.reply({
        id: 2,
        jsonrpc: "2.0",
        method: "client/unregisterCapability",
        params: { unregisterations: [{ id: "watch", method: "workspace/didChangeWatchedFiles" }] },
      });
      yield* Queue.take(peer.sent);
      yield* peer.connection.watchedFilesChanged(
        REPO,
        [{ path: "a.py", renamed: true }],
        NOT_TRACKED,
      );
      return yield* notificationsSent(peer);
    }),
  );

  expect(notifications).toEqual([]);
});

test("out-of-worktree search paths surface as bases to watch", async () => {
  const venv = join(sep, "home", "me", ".virtualenvs", "app");
  const bases = await withPeer((peer) =>
    peer
      .reply(watchRegistration(venv))
      .pipe(Effect.andThen(Stream.runHead(peer.connection.watchedBases))),
  );

  // The `**` workspace glob rides the worktree watcher; only the external venv needs its own watch.
  expect(bases).toEqual(Option.some([venv]));
});

test("a publish answering what the run just sent does not nudge a re-check", async () => {
  let rechecks = 0;
  await withPeer(
    (peer) =>
      Effect.gen(function* run() {
        // A run re-sends a document: `clearPublished` opens the awaited window on it.
        yield* peer.connection.clearPublished(["file:///a.py"]);
        // Pyright answers with an empty publish, then refines it once analysis finishes. Both answer
        // What this run sent, and the run is already waiting on them.
        yield* peer.reply(publish("file:///a.py", []));
        yield* peer.reply(publish("file:///a.py", [{ message: "unresolved import" }]));
        yield* notificationsSent(peer);
      }),
    Effect.sync(() => {
      rechecks += 1;
    }),
  );

  expect(rechecks).toBe(0);
});

test("a server correcting itself out of band nudges exactly one re-check", async () => {
  let rechecks = 0;
  await withPeer(
    (peer) =>
      Effect.gen(function* run() {
        yield* peer.connection.clearPublished(["file:///a.py"]);
        yield* peer.reply(publish("file:///a.py", [{ message: "unresolved import" }]));
        yield* notificationsSent(peer);
        // The run has read the bucket and finished; the awaited window closes.
        yield* peer.connection.published;
        yield* peer.connection.endPublishWait;

        // `uv add fastapi` lands. Pyright reloads its library and re-analyzes on its own: nothing is
        // Waiting for this, so without the nudge it sits unread and the panel stays red forever.
        yield* peer.reply(publish("file:///a.py", []));
        // A republish of the same items is not news, so it must not nudge again.
        yield* peer.reply(publish("file:///a.py", []));
        yield* notificationsSent(peer);
      }),
    Effect.sync(() => {
      rechecks += 1;
    }),
  );

  expect(rechecks).toBe(1);
});

test("a publish no run is waiting for is news, clean or not", async () => {
  let rechecks = 0;
  await withPeer(
    (peer) =>
      Effect.gen(function* run() {
        // No `clearPublished`, so no awaited window: this is a server reporting on a file stet never
        // Opened (a cross-file report). Findings there are news, and nothing else would render them.
        yield* peer.reply(publish("file:///never-opened.py", [{ message: "unresolved import" }]));
        yield* notificationsSent(peer);
      }),
    Effect.sync(() => {
      rechecks += 1;
    }),
  );
  expect(rechecks).toBe(1);

  let late = 0;
  await withPeer(
    (peer) =>
      Effect.gen(function* run() {
        // A run re-sent this document, then capped out its settle without an answer, so the file is
        // Sitting at `pending`.
        yield* peer.connection.clearPublished(["file:///slow.py"]);
        yield* peer.connection.published;
        yield* peer.connection.endPublishWait;

        // The server finally answers, and the answer is that the file is clean. That is the result
        // The run never got: no entry is not the same as an empty entry, and treating it as one
        // Stranded the file at `pending` until the next git activity.
        yield* peer.reply(publish("file:///slow.py", []));
        yield* notificationsSent(peer);
      }),
    Effect.sync(() => {
      late += 1;
    }),
  );
  expect(late).toBe(1);
});
