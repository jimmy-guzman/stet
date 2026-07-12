import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect, Exit, Layer, Queue, Scope, Stream } from "effect";
import { adjust, layer as testClockLayer } from "effect/testing/TestClock";

import { LspProcess } from "@/diagnostics/lsp-process";
import { Provisioner } from "@/diagnostics/provision";
import {
  LanguageServers,
  LanguageServersLive,
  registerLanguages,
  registerServers,
  restoreLanguages,
  restoreServers,
  snapshotLanguages,
  snapshotServers,
} from "@/diagnostics/servers";
import type { LspConnection } from "@/diagnostics/transport";
import type { WatchedFileEvent } from "@/diagnostics/watched-files";

/** A connection that records the watched-file events the pool routed to it. No process, no mocks. */
function fakeConnection() {
  const received: WatchedFileEvent[] = [];
  const connection: LspConnection = {
    changeDocument: () => Effect.void,
    clearPublished: () => Effect.void,
    closeDocument: () => Effect.void,
    closed: Effect.sync(() => false),
    endPublishWait: Effect.void,
    notify: () => Effect.void,
    openDocument: () => Effect.void,
    published: Effect.sync(() => new Map<string, unknown[]>()),
    pullDiagnostics: () => Effect.die("unused"),
    request: () => Effect.succeed({ capabilities: {} }),
    watchedBases: Stream.empty,
    watchedFilesChanged: (events) => Effect.sync(() => void received.push(...events)),
    whenProjectLoaded: Effect.void,
  };
  return { connection, received };
}

test("a server evicted while still referenced does not retract its replacement", async () => {
  const snapshotS = snapshotServers();
  const snapshotL = snapshotLanguages();
  const repo = mkdtempSync(join(tmpdir(), "pool-"));
  // `bun` is on PATH, so the command resolves and the pool takes the normal (non-provisioning) path;
  // The fake LspProcess below means nothing is ever actually spawned.
  registerServers({ fakelsp: { args: [], binary: "bun", provides: [] } });
  registerLanguages({ fake: { extensions: { fake: "fake" }, servers: ["fakelsp"] } });

  const spawned: ReturnType<typeof fakeConnection>[] = [];
  const lspProcess = Layer.effect(
    LspProcess,
    Effect.gen(function* fake() {
      const refreshes = yield* Queue.unbounded<string>();
      return {
        refreshes,
        start: () =>
          Effect.acquireRelease(
            Effect.sync(() => {
              const made = fakeConnection();
              spawned.push(made);
              return made.connection;
            }),
            () => Effect.void,
          ),
      };
    }),
  );
  const provisioner = Layer.effect(
    Provisioner,
    Effect.gen(function* fake() {
      const starts = yield* Queue.unbounded<string>();
      const completions = yield* Queue.unbounded<string>();
      // Never reached: `bun` resolves on PATH, so the pool takes the discovery path, not this one.
      return {
        completions,
        ensure: () => Effect.succeed({ command: ["bun"], kind: "ready" as const }),
        starts,
      };
    }),
  );

  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* scenario() {
          const servers = yield* LanguageServers;

          // The intel warm-hold: it acquires the server and holds it for the whole session, so the
          // Pool's refcount for this key never drops to zero while a file of that language is open.
          const warmHold = yield* Scope.make();
          yield* servers.acquire("fakelsp", repo).pipe(Scope.provide(warmHold));

          // `R`: evict the repo's servers. The warm-hold still holds a reference, so `RcMap` drops
          // The key from the pool WITHOUT closing the old entry's scope.
          yield* servers.restart(repo);

          // The next run brings up a replacement, which is what the user is now looking at.
          const run = yield* Scope.make();
          yield* servers.acquire("fakelsp", repo).pipe(Scope.provide(run));
          expect(spawned).toHaveLength(2);

          // The warm-hold finally lets go (a worktree switch, a file of another language). Only now
          // Does the OLD entry's scope close and its finalizer run.
          yield* Scope.close(warmHold, Exit.void);

          // The old entry is now unreferenced but its key belongs to the replacement, so it does not
          // Close at once: it parks on the pool's 30s idle timer. The corruption lands when that
          // Timer finally fires, which is why this is a silent, delayed failure rather than an
          // Immediate one.
          yield* adjust("31 seconds");

          yield* servers.notifyWatchedFiles(repo, [
            { path: join(repo, "site-packages", "fastapi", "__init__.py"), type: 1 },
          ]);
        }),
        // One combined provide: the pool's idle timer reads the same clock `adjust` drives, so the
        // Test must not build a second TestClock in a separate layer.
      ).pipe(
        Effect.provide(
          LanguageServersLive.pipe(
            Layer.provideMerge(Layer.mergeAll(lspProcess, provisioner, testClockLayer())),
          ),
        ),
      ),
    );

    // The replacement must still be reachable. A finalizer that retracted by key alone would have
    // Removed it here, and the dependency-install channel would go silently dead for the session.
    expect(spawned[1]?.received).toHaveLength(1);
    expect(spawned[0]?.received).toHaveLength(0);
  } finally {
    restoreServers(snapshotS);
    restoreLanguages(snapshotL);
    rmSync(repo, { force: true, recursive: true });
  }
});
