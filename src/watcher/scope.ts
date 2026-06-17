import { sep } from "node:path";

/**
 * The filesystem roots to watch for a worktree. The worktree tree catches file edits; the resolved
 * git dir catches staging/commit/checkout. In a normal repo the git dir lives at `<root>/.git`,
 * already inside the recursively-watched tree, so it is dropped as redundant. In a linked worktree
 * the git dir resolves outside the tree and is watched as a second root.
 */
export function watchRoots(repoRoot: string, gitDir: string | undefined) {
  if (gitDir === undefined || gitDir === repoRoot || gitDir.startsWith(repoRoot + sep)) {
    return [repoRoot];
  }
  return [repoRoot, gitDir];
}
