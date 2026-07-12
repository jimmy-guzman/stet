import { expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Effect, Fiber, Layer, Option, Stream } from "effect";

import { GitLive } from "@/git/service";
import { ProcessLive } from "@/process";
import { Watcher, WatcherLive } from "@/watcher/service";
import type { WatchedChange } from "@/watcher/service";

import { createFixtureRepo } from "./helpers";

const WatcherTest = WatcherLive.pipe(Layer.provide(GitLive), Layer.provide(ProcessLive));

test("Watcher.changes emits the changed worktree path when a file changes", async () => {
  const repo = createFixtureRepo("watcher-service-", { "a.txt": "one\n" });
  try {
    let writes = 0;
    const first = await Effect.runPromise(
      Effect.gen(function* program() {
        const watcher = yield* Watcher;
        const collecting = yield* Effect.forkChild(watcher.changes(repo).pipe(Stream.runHead));
        // The watcher attaches fs.watch only after a git-dir subprocess resolves.
        // A fixed arm delay can't cover that on a loaded runner.
        // So nudge repeatedly (interval > debounce, varied content) until a tick lands.
        const writing = yield* Effect.forkChild(
          Effect.suspend(() => {
            writes += 1;
            writeFileSync(join(repo, "a.txt"), `one\n${writes}\n`);
            return Effect.void;
          }).pipe(Effect.delay("150 millis"), Effect.forever),
        );
        const collected = yield* Fiber.join(collecting).pipe(Effect.timeout("3 seconds"));
        yield* Fiber.interrupt(writing);
        return collected;
      }).pipe(Effect.provide(WatcherTest)),
    );

    // A tracked working-tree edit, so its path rides the batch (which drives intel invalidation).
    const changes = Option.getOrElse(first, () => [] as readonly WatchedChange[]);
    expect(changes.map((change) => change.path)).toContain("a.txt");
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});

test("a file that appears is reported as renamed, not merely changed", async () => {
  const repo = createFixtureRepo("watcher-created-", { "a.txt": "one\n" });
  try {
    let writes = 0;
    const first = await Effect.runPromise(
      Effect.gen(function* program() {
        const watcher = yield* Watcher;
        const collecting = yield* Effect.forkChild(watcher.changes(repo).pipe(Stream.runHead));
        // Same nudge-until-armed shape as above, but each nudge creates a *new* path.
        const writing = yield* Effect.forkChild(
          Effect.suspend(() => {
            writes += 1;
            writeFileSync(join(repo, `new-${writes}.txt`), "hello\n");
            return Effect.void;
          }).pipe(Effect.delay("150 millis"), Effect.forever),
        );
        const collected = yield* Fiber.join(collecting).pipe(Effect.timeout("3 seconds"));
        yield* Fiber.interrupt(writing);
        return collected;
      }).pipe(Effect.provide(WatcherTest)),
    );

    // The rename flag is what tells a language server the path *appeared*. Without it, a package
    // Landing in `.venv` reads as an ordinary edit and pyright never rescans for it (#277).
    const changes = Option.getOrElse(first, () => [] as readonly WatchedChange[]);
    const created = changes.filter((change) => change.path.startsWith("new-"));
    expect(created.length).toBeGreaterThan(0);
    expect(created.every((change) => change.renamed)).toBe(true);
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});
