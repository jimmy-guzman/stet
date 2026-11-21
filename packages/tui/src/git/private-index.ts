import { randomUUID } from "node:crypto";
import type { BigIntStats } from "node:fs";
import {
  constants,
  copyFileSync,
  mkdtempSync,
  rmSync,
  statSync,
  utimesSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

/**
 * The environment for a read that runs against a private copy of the index.
 *
 * `git status` and `git diff` stay exact only while they may refresh the index: the in-memory skip
 * of stat-only changes (`diffcore_skip_stat_unmatch`) rides on `diff.autoRefreshIndex`, and `git
 * status` persists what it hashed only under optional locks. Pointed at a copy, both write the
 * copy, so a file whose mtime moved without its content is hashed once rather than every tick and
 * no lock is ever taken on the real index. `core.splitIndex=false` keeps a split-index repository's
 * copy from being written back as a split index, which creates `sharedindex.*` files in the real
 * git dir.
 */
export const privateIndexEnv = (copy: string) => ({
  GIT_CONFIG_COUNT: "2",
  GIT_CONFIG_KEY_0: "diff.autoRefreshIndex",
  GIT_CONFIG_KEY_1: "core.splitIndex",
  GIT_CONFIG_VALUE_0: "true",
  GIT_CONFIG_VALUE_1: "false",
  GIT_INDEX_FILE: copy,
  GIT_OPTIONAL_LOCKS: "1",
});

/**
 * One private copy per real index, under a directory of this process's own that is removed on
 * teardown or exit. `copyFor` returns the copy to read through, re-copying whenever the real index
 * was rewritten (staging, a commit, a checkout), or `undefined` when there is no index file yet.
 *
 * Synchronous on purpose: two reads that sync the same index at once must agree on one copy, and a
 * clone of even a large index is a few milliseconds.
 */
export const createIndexCopies = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "stet-index-"));
  const copies = new Map<string, { identity: string; path: string }>();

  const remove = () => {
    rmSync(dir, { force: true, recursive: true });
  };

  process.once("exit", remove);

  const syncCopy = (indexPath: string, real: BigIntStats) => {
    const identity = `${real.ino}:${real.size}:${real.mtimeNs}:${real.ctimeNs}`;
    const current = copies.get(indexPath);

    if (current?.identity === identity) {
      return current.path;
    }

    // A fresh name per copy: a git child from an earlier tick that finishes late renames its
    // refresh onto the copy it read, and must not land on top of this newer one.
    const next = path.join(dir, randomUUID());
    copyFileSync(indexPath, next, constants.COPYFILE_FICLONE);
    // Git judges an entry racily clean against the index file's own mtime, so the copy keeps the
    // real one. A copy stamped now made a same-second edit after `git add` look clean (missed 5 of
    // 5 trials). Truncating to milliseconds only moves it earlier, which marks more entries racy
    // and re-checks them, never fewer.
    const mtime = new Date(Number(real.mtimeNs / 1_000_000n));
    utimesSync(next, mtime, mtime);
    copies.set(indexPath, { identity, path: next });

    if (current !== undefined) {
      rmSync(current.path, { force: true });
    }

    return next;
  };

  const forget = (indexPath: string) => {
    const current = copies.get(indexPath);

    if (current !== undefined) {
      rmSync(current.path, { force: true });
      copies.delete(indexPath);
    }
  };

  return {
    copyFor: (indexPath: string) => {
      const real = statSync(indexPath, {
        bigint: true,
        throwIfNoEntry: false,
      });

      // An index that is gone (a removed worktree) takes its copy with it, so a long session never
      // collects copies of repositories that no longer exist.
      if (real === undefined) {
        forget(indexPath);
      }

      return real === undefined ? undefined : syncCopy(indexPath, real);
    },
    dispose: () => {
      process.off("exit", remove);
      remove();
    },
  };
};
