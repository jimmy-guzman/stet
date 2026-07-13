import { watch } from "node:fs";

import { Context, Effect, Layer, Queue, Stream } from "effect";

import { Git } from "@/git/service";

import { classify } from "./filter";
import { watchRoots } from "./scope";

const DEBOUNCE_MS = 100;

/**
 * One worktree-relative path written this batch, and whether `fs.watch` called it a rename.
 *
 * The rename flag is the only evidence available that a path **appeared or vanished** rather than
 * merely being rewritten in place, and it is load-bearing downstream: a language server rescans its
 * import search paths for new packages only when told a file was _created_, so an install reported
 * as a mere change leaves the import unresolved (see `watchedFileEvent`).
 */
export interface WatchedChange {
  readonly path: string;
  readonly renamed: boolean;
}

/**
 * Filesystem-change batches for a worktree, debounced so an agent's burst of writes collapses into
 * one. Each emit means "something changed, re-derive git state"; its array is the worktree-relative
 * paths written this batch (empty for a git-internal-only or nameless batch). The consumer ticks
 * the git refresh on every emit, invalidates the content-keyed intel cache only for a path it knows
 * is tracked (so gitignored churn like `node_modules/` does not wipe the cache, and a commit, which
 * touches only `.git`, carries no path), and forwards the whole batch to the language servers, for
 * which that same gitignored churn is the entire point. Watch failures (a platform without
 * recursive support, a sandbox without inotify) are swallowed: that root simply never ticks and the
 * caller's slow poll remains the correctness floor.
 */
export class Watcher extends Context.Service<
  Watcher,
  {
    readonly changes: (repoRoot: string) => Stream.Stream<readonly WatchedChange[]>;
  }
>()("stet/Watcher") {}

/**
 * Creates a stream of debounced filesystem changes for the specified watch roots.
 *
 * @param roots - Watch roots used to monitor worktree files
 * @returns Batches of worktree changes, including whether each path involved a rename
 */
function watchStream(roots: ReturnType<typeof watchRoots>) {
  return Stream.callback<readonly WatchedChange[]>(
    (queue) =>
      Effect.gen(function* watch_() {
        // Debounce inside the callback so a burst collapses to one emit. `pending` accumulates the
        // Named worktree paths written in the window; a plain keep-last `Stream.debounce` would drop
        // Earlier paths whenever the window's last event was git-internal or a different file. A
        // Path that saw any rename this window stays a rename: appearing then being written is still
        // An appearance, and that is the signal a server needs to rescan for it.
        const pending = new Map<string, boolean>();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const flush = () => {
          timer = undefined;
          const changes = [...pending].map(([path, renamed]) => ({ path, renamed }));
          // Clear the pending set only once the emit is accepted. The callback queue is bufferSize-1
          // Dropping, so a burst could drop this offer; if it carried worktree paths (the intel
          // Signal) keep them and retry rather than losing them. A dropped empty batch is only a
          // Git-refresh tick, and the safety poll is its floor.
          if (Queue.offerUnsafe(queue, changes)) {
            pending.clear();
          } else if (pending.size > 0) {
            timer = setTimeout(flush, DEBOUNCE_MS);
          }
        };
        const watchers = roots.flatMap((root) => {
          try {
            const watcher = watch(root.path, { recursive: true }, (event, filename) => {
              const kind = classify(root.gitInternalPrefix, filename);
              if (kind === "ignored") {
                return;
              }
              // A named worktree write is intel-relevant; a git-internal or nameless event still
              // Ticks the refresh but carries no path (nameless real edits ride the mtime poll floor).
              if (kind === "worktree" && typeof filename === "string") {
                pending.set(filename, (pending.get(filename) ?? false) || event === "rename");
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
