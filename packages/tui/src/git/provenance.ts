import type { BlameLine } from "./blame";

/**
 * A line's place on the provenance timeline, oldest to newest, each tier more recent and more
 * "yours": the file's first commit (`initial`), a later base-branch commit (`changed`), a commit on
 * this branch before the session (`branch`), a commit since stet launched (`session`), or a
 * working-tree line (`uncommitted`). The scrutiny order is exactly this order.
 */
export type Provenance = "uncommitted" | "session" | "branch" | "changed" | "initial";

export interface ProvenanceContext {
  /** Commits in `sessionBase..HEAD` (committed since stet launched). */
  sessionShas: ReadonlySet<string>;
  /** Commits in `branchBase..HEAD` (this branch plus the session, a superset of `sessionShas`). */
  branchShas: ReadonlySet<string>;
  /** The commit that introduced the open file, or `undefined` when it can't be resolved. */
  fileFirstSha: string | undefined;
}

// Ordered so a newer/closer tier wins an overlap: a file first committed this session reads
// `session`, not `initial`; a branch commit that is also a session commit reads `session`.
export function classifyProvenance(line: BlameLine, ctx: ProvenanceContext): Provenance {
  if (line.uncommitted) {
    return "uncommitted";
  }
  if (ctx.sessionShas.has(line.sha)) {
    return "session";
  }
  if (ctx.branchShas.has(line.sha)) {
    return "branch";
  }
  return line.sha === ctx.fileFirstSha ? "initial" : "changed";
}

// The commits reachable from HEAD but not from `base`. Used for both `sessionBase..HEAD` (the
// Session set) and `branchBase..HEAD` (the branch set, a superset), so no range query is needed:
// `base === HEAD` yields an empty set, which reads every committed line as one of the older tiers.
export function commitsSinceArgs(base: string) {
  return ["git", "rev-list", `${base}..HEAD`];
}

export function parseRevList(stdout: string): Set<string> {
  return new Set(stdout.split("\n").filter((sha) => sha !== ""));
}

// The commit that introduced the file: `--diff-filter=A` limits output to the add commit(s), and
// The oldest (last line) is the file's first commit.
export function firstCommitArgs(path: string) {
  return ["git", "log", "--format=%H", "--diff-filter=A", "--", path];
}

export function parseFirstCommit(stdout: string): string | undefined {
  return stdout.split("\n").findLast((sha) => sha !== "");
}

// The repo's default branch (e.g. `origin/main`) as `origin/HEAD` points, and the merge-base of
// HEAD with it, i.e. where this branch left the default branch.
export function defaultBranchArgs() {
  return ["git", "symbolic-ref", "--short", "refs/remotes/origin/HEAD"];
}

export function mergeBaseArgs(ref: string) {
  return ["git", "merge-base", "HEAD", ref];
}
