import { fileMtime } from "./model";

export interface Worktree {
  path: string;
  head: string;
  branch?: string;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
}

/**
 * What a worktree looks like from the outside: how much uncommitted work sits in it, and when it
 * last moved. `lastActivityAt` is the newest mtime across its changed files, so it is the file's
 * own timestamp rather than the moment we noticed, and a poll that runs late still reports an exact
 * age.
 */
export interface WorktreeSummary {
  path: string;
  changed: number;
  lastActivityAt: number | undefined;
}

/** How often the background poll re-summarizes the other worktrees. */
export const PEER_SUMMARY_MS = 5000;

// -uall so an untracked directory is not collapsed to `dir/`: the count must be the same number the
// Header shows for that worktree once you switch into it.
export const worktreeStatusArgs = ["git", "status", "--porcelain=v1", "-uall", "-z"];

export function parseWorktreeList(output: string): Worktree[] {
  const worktrees: Worktree[] = [];

  // With -z every attribute line ends in NUL and each record ends in an extra NUL
  for (const record of output.split("\0\0")) {
    const attributes = record.split("\0").filter((line) => line !== "");
    const first = attributes[0];
    if (first === undefined || !first.startsWith("worktree ")) {
      continue;
    }

    const worktree: Worktree = {
      bare: false,
      detached: false,
      head: "",
      locked: false,
      path: first.slice("worktree ".length),
      prunable: false,
    };

    for (const attribute of attributes.slice(1)) {
      if (attribute.startsWith("HEAD ")) {
        worktree.head = attribute.slice("HEAD ".length);
      } else if (attribute.startsWith("branch ")) {
        const ref = attribute.slice("branch ".length);
        worktree.branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
      } else if (attribute === "bare") {
        worktree.bare = true;
      } else if (attribute === "detached") {
        worktree.detached = true;
      } else if (attribute === "locked" || attribute.startsWith("locked ")) {
        worktree.locked = true;
      } else if (attribute === "prunable" || attribute.startsWith("prunable ")) {
        worktree.prunable = true;
      }
    }

    worktrees.push(worktree);
  }

  return worktrees;
}

/**
 * One path per changed file. A rename/copy record's trailing original path is consumed rather than
 * counted, so a rename is one changed file: `parsePorcelainStatus` deliberately maps that original
 * as a second key (it needs the stage state under both names), which would double-count here.
 */
export function parseWorktreeStatusPaths(output: string) {
  const tokens = output.split("\0");
  const paths: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined || token.length < 4) {
      continue;
    }

    paths.push(token.slice(3));

    if (token.startsWith("R") || token.startsWith("C") || token[1] === "R" || token[1] === "C") {
      index += 1;
    }
  }

  return paths;
}

export function summarizeWorktree(path: string, statusOutput: string): WorktreeSummary {
  const changed = parseWorktreeStatusPaths(statusOutput);
  // A deleted (or vanished-mid-scan) file stats to 0 and so drops out of the max on its own.
  const newest = changed.reduce((max, entry) => Math.max(max, fileMtime(path, entry)), 0);
  return { changed: changed.length, lastActivityAt: newest === 0 ? undefined : newest, path };
}

/**
 * Keeps the previous map when nothing moved, so an idle repo's poll is inert: the summaries feed
 * the recency clock, and a fresh map every tick would wake every dot on the screen to redraw itself
 * unchanged.
 */
export function mergeWorktreeSummaries(
  previous: Map<string, WorktreeSummary>,
  next: readonly WorktreeSummary[],
) {
  const unchanged =
    previous.size === next.length &&
    next.every((summary) => {
      const before = previous.get(summary.path);
      return (
        before?.changed === summary.changed && before.lastActivityAt === summary.lastActivityAt
      );
    });

  return unchanged ? previous : new Map(next.map((summary) => [summary.path, summary]));
}

/**
 * Picker order: the main worktree first (the repository's anchor, not a rotating position), then
 * the ones that moved most recently, so the worktree an agent is working in rises to the top.
 * Computed once when the picker opens, never on a summary refresh, so the list cannot reorder under
 * the cursor while it is open.
 */
export function orderWorktrees(
  worktrees: readonly Worktree[],
  summaries: ReadonlyMap<string, WorktreeSummary>,
  mainWorktreePath: string,
) {
  const activity = (worktree: Worktree) => summaries.get(worktree.path)?.lastActivityAt ?? 0;

  return worktrees.toSorted((a, b) => {
    if (a.path === mainWorktreePath) {
      return -1;
    }
    if (b.path === mainWorktreePath) {
      return 1;
    }
    return activity(b) - activity(a) || a.path.localeCompare(b.path);
  });
}
