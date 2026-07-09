import { expect, test } from "bun:test";

import { Effect, Queue } from "effect";

import type { JsonRpcMessage } from "@/diagnostics/jsonrpc";
import { createByteChannel, LspProcess, LspProcessLive } from "@/diagnostics/lsp-process";

/**
 * `cat` echoes stdin to stdout, so a framed message written through the channel comes back as the
 * same decoded message. This exercises the real read-loop, stdin write, and framing over an actual
 * OS pipe, without needing a language server.
 */
test("byte channel round-trips framed messages through a real subprocess", async () => {
  const received = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* roundTrip() {
        const child = yield* Effect.acquireRelease(
          Effect.sync(() =>
            Bun.spawn({ cmd: ["cat"], stderr: "pipe", stdin: "pipe", stdout: "pipe" }),
          ),
          (process) => Effect.sync(() => process.kill()),
        );
        const channel = yield* createByteChannel(child);

        const outgoing: JsonRpcMessage = {
          id: 1,
          jsonrpc: "2.0",
          method: "ping",
          params: { n: 1 },
        };
        const second: JsonRpcMessage = { jsonrpc: "2.0", method: "note", params: { text: "café" } };
        yield* channel.send(outgoing);
        yield* channel.send(second);

        return [yield* Queue.take(channel.inbound), yield* Queue.take(channel.inbound)];
      }),
    ),
  );

  expect(received).toEqual([
    { id: 1, jsonrpc: "2.0", method: "ping", params: { n: 1 } },
    { jsonrpc: "2.0", method: "note", params: { text: "café" } },
  ]);
});

/**
 * The refresh seam end-to-end over a real child process: a server-sent
 * `workspace/diagnostic/refresh` lands on the service's shared queue as the repo root that
 * `state.ts` gates re-checks on, and the transport answers the request so the server never stalls.
 */
test("a server's refresh request enqueues its repo root on the shared queue", async () => {
  const emit = `
    const message = JSON.stringify({ id: 1, jsonrpc: "2.0", method: "workspace/diagnostic/refresh" });
    process.stdout.write("Content-Length: " + Buffer.byteLength(message) + "\\r\\n\\r\\n" + message);
    setTimeout(() => {}, 5000);
  `;
  const refreshedRoot = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* refresh() {
        const lsp = yield* LspProcess;
        yield* lsp.start([process.execPath, "-e", emit], process.cwd());
        return yield* Queue.take(lsp.refreshes);
      }),
    ).pipe(Effect.provide(LspProcessLive), Effect.timeout("5 seconds")),
  );
  expect(refreshedRoot).toBe(process.cwd());
});
