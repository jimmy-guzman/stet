import { watch } from "node:fs";

import { Context, Effect, Layer, Queue, Stream } from "effect";

import { Git } from "@/git/service";

import { classify } from "./filter";
import { watchRoots } from "./scope";

const DEBOUNCE_MS = 100;

/**
 * Filesystem-change ticks for a worktree, debounced so an agent's burst of writes collapses into
 * one. Each tick means "something changed, re-derive git state"; the boolean is whether the batch
 * included a tracked working-tree write (vs a git-internal change like HEAD/index/refs), so the
 * consumer can invalidate the content-keyed intel cache on real edits but not on commits or scope
 * moves. Watch failures (a platform without recursive support, a sandbox without inotify) are
 * swallowed: that root simply never ticks and the caller's slow poll remains the correctness
 * floor.
 */
export class Watcher extends Context.Service<
  Watcher,
  {
    readonly changes: (repoRoot: string) => Stream.Stream<boolean>;
  }
>()("stet/Watcher") {}

function watchStream(roots: ReturnType<typeof watchRoots>) {
  return Stream.callback<boolean>(
    (queue) =>
      Effect.gen(function* watch_() {
        // Debounce inside the callback so a burst collapses to one emit while the per-batch
        // Worktree-changed flag survives the window: a plain keep-last `Stream.debounce` would
        // Drop an earlier worktree write whenever the window's last event was git-internal.
        let worktreeChanged = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const flush = () => {
          Queue.offerUnsafe(queue, worktreeChanged);
          worktreeChanged = false;
          timer = undefined;
        };
        const watchers = roots.flatMap((root) => {
          try {
            const watcher = watch(root.path, { recursive: true }, (_event, filename) => {
              const kind = classify(root.gitInternalPrefix, filename);
              if (kind === "ignored") {
                return;
              }
              if (kind === "worktree") {
                worktreeChanged = true;
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
