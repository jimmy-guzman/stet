import { expect, test } from "bun:test";
import path from "node:path";

import { watchRoots } from "@/watcher/scope";

test("watchRoots drops a git dir that lives inside the worktree", () => {
  const root = `${path.sep}repo`;
  expect(watchRoots(root, `${root}${path.sep}.git`)).toEqual([
    { gitInternalPrefix: `.git${path.sep}`, path: root },
  ]);
});

test("watchRoots keeps a linked-worktree git dir that lives outside the worktree", () => {
  const root = `${path.sep}repo${path.sep}wt`;
  const gitDir = `${path.sep}repo${path.sep}.git${path.sep}worktrees${path.sep}wt`;
  expect(watchRoots(root, gitDir)).toEqual([
    { gitInternalPrefix: `.git${path.sep}`, path: root },
    { gitInternalPrefix: "", path: gitDir },
  ]);
});

test("watchRoots drops a git dir equal to the worktree root", () => {
  const root = `${path.sep}repo`;
  expect(watchRoots(root, root)).toEqual([
    { gitInternalPrefix: `.git${path.sep}`, path: root },
  ]);
});

test("watchRoots watches only the worktree when the git dir is unknown", () => {
  const root = `${path.sep}repo`;
  expect(watchRoots(root, undefined)).toEqual([
    { gitInternalPrefix: `.git${path.sep}`, path: root },
  ]);
});
