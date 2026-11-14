import { watch } from "node:fs";

import { Context, Effect, Layer, Queue, Stream } from "effect";

import { Git } from "@/git/service";

import { classify } from "./filter";
import { watchRoots } from "./scope";

const DEBOUNCE_MS = 100;

/**
 * Filesystem-change ticks for a worktree, debounced so an agent's burst of writes collapses into
 * one. Each emit means "something changed, re-derive git state". Watch failures (a platform without
 * recursive support, a sandbox without inotify) are swallowed: that root simply never ticks and the
 * caller's slow poll remains the correctness floor.
 */
export class Watcher extends Context.Service<
  Watcher,
  {
    readonly changes: (repoRoot: string) => Stream.Stream<void>;
  }
>()("stet/Watcher") {}

/**
 * Creates a stream of debounced filesystem-change ticks for the specified watch roots.
 *
 * @param roots - Watch roots used to monitor worktree files
 * @returns One tick per debounced burst of changes
 */
function watchStream(roots: ReturnType<typeof watchRoots>) {
  return Stream.callback<void>(
    (queue) =>
      Effect.gen(function* watch_() {
        // Debounce inside the callback so a burst collapses to one emit. The queue is bufferSize-1
        // Dropping, so a tick offered while one is still pending is redundant and dropped; the
        // Safety poll is the floor for anything lost.
        let timer: ReturnType<typeof setTimeout> | undefined;
        const flush = () => {
          timer = undefined;
          Queue.offerUnsafe(queue, undefined);
        };
        const watchers = roots.flatMap((root) => {
          try {
            const watcher = watch(root.path, { recursive: true }, (_event, filename) => {
              if (classify(root.gitInternalPrefix, filename) === "ignored") {
                return;
              }
              if (timer !== undefined) {
                clearTimeout(timer);
              }
              timer = setTimeout(flush, DEBOUNCE_MS);
            });
            // An async watcher error (e.g. the root is removed) must not crash the
            // Stream; drop it and let the slow poll cover that root.
            watcher.on("error", () => {});
            return [watcher];
          } catch {
            return [];
          }
        });
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (timer !== undefined) {
              clearTimeout(timer);
            }
            for (const watcher of watchers) {
              watcher.close();
            }
          }),
        );
        return yield* Effect.never;
      }),
    { bufferSize: 1, strategy: "dropping" },
  );
}

export const WatcherLive = Layer.effect(
  Watcher,
  Effect.gen(function* watcherLive() {
    const git = yield* Git;

    return {
      changes: (repoRoot) =>
        Stream.unwrap(
          git.gitDir(repoRoot).pipe(
            Effect.map((gitDir) => watchStream(watchRoots(repoRoot, gitDir))),
            Effect.orElseSucceed(() => watchStream(watchRoots(repoRoot, undefined))),
          ),
        ),
    };
  }),
);
