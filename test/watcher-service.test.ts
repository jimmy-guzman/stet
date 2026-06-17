import { expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Effect, Fiber, Layer, Stream } from "effect";

import { GitLive } from "../src/git/service";
import { ProcessLive } from "../src/process";
import { Watcher, WatcherLive } from "../src/watcher/service";
import { createFixtureRepo } from "./helpers";

const WatcherTest = WatcherLive.pipe(Layer.provide(GitLive), Layer.provide(ProcessLive));

test("Watcher.changes emits a debounced tick when a file changes", async () => {
  const repo = createFixtureRepo("watcher-service-", { "a.txt": "one\n" });
  try {
    const ticks = await Effect.runPromise(
      Effect.gen(function* program() {
        const watcher = yield* Watcher;
        const collecting = yield* Effect.forkChild(
          watcher.changes(repo).pipe(Stream.take(1), Stream.runCount),
        );
        // Let the watcher arm, then make a real change in the worktree.
        yield* Effect.sleep("50 millis");
        yield* Effect.sync(() => writeFileSync(join(repo, "a.txt"), "one\ntwo\n"));
        return yield* Fiber.join(collecting).pipe(Effect.timeout("3 seconds"));
      }).pipe(Effect.provide(WatcherTest)),
    );

    expect(ticks).toBe(1);
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});
