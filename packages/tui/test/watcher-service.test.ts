import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { Effect, Fiber, Layer, Option, Stream } from "effect";

import { GitLive } from "@/git/service";
import { ProcessLive } from "@/process";
import { Watcher, WatcherLive } from "@/watcher/service";

import { createFixtureRepo } from "./helpers";

const WatcherTest = WatcherLive.pipe(
  Layer.provide(GitLive),
  Layer.provide(ProcessLive)
);

test("Watcher.changes ticks when a worktree file changes", async () => {
  const repo = createFixtureRepo("watcher-service-", { "a.txt": "one\n" });

  let writes = 0;

  const first = await Effect.runPromise(
    Effect.gen(function* program() {
      const watcher = yield* Watcher;

      const collecting = yield* Effect.forkChild(
        watcher.changes(repo).pipe(Stream.runHead)
      );

      // The watcher attaches fs.watch only after a git-dir subprocess resolves.
      // A fixed arm delay can't cover that on a loaded runner.
      // So nudge repeatedly (interval > debounce, varied content) until a tick lands.
      const writing = yield* Effect.forkChild(
        Effect.suspend(() => {
          writes += 1;
          writeFileSync(path.join(repo, "a.txt"), `one\n${writes}\n`);

          return Effect.void;
        }).pipe(Effect.delay("150 millis"), Effect.forever)
      );

      const collected = yield* Fiber.join(collecting).pipe(
        Effect.timeout("3 seconds")
      );

      yield* Fiber.interrupt(writing);

      return collected;
    }).pipe(Effect.provide(WatcherTest))
  );

  expect(Option.isSome(first)).toBe(true);
});
