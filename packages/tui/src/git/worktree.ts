import { readFileSync, statSync } from "node:fs";

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
 * When a worktree was last touched, by an agent or by git. It is a real timestamp (a file mtime or
 * a commit date), never the moment we noticed, so a poll that runs late still reports an exact
 * age.
 */
export interface WorktreeSummary {
  path: string;
  lastActivityAt: number | undefined;
}

/** How often the background poll re-summarizes the worktrees. */
export const PEER_SUMMARY_MS = 5000;

/**
 * How long a worktree keeps counting as active after it was last touched. Deliberately far longer
 * than the 30s `RECENT_MS` a changed _file_ stays fresh for: that window is tuned to flash a row in
 * the tree, whereas an agent pauses for minutes at a time (thinking, running tests, waiting on a
 * build) and is plainly still working in the worktree the whole time.
 */
export const WORKTREE_ACTIVE_MS = 5 * 60_000;

// -uall so an untracked directory is not collapsed to `dir/`, whose own mtime would not move when a
// File deep inside it is written.
export const worktreeStatusArgs = ["git", "status", "--porcelain=v1", "-uall", "-z"];

/** One call for every worktree's HEAD, since they all share the repository's object database. */
export function commitTimeArgs(heads: readonly string[]) {
  return ["git", "show", "-s", "--format=%H %ct", ...heads];
}

export function parseCommitTimes(output: string) {
  return new Map(
    output
      .split("\n")
      .map((line) => line.split(" "))
      .filter((parts) => parts.length === 2)
      .flatMap(([sha, seconds]) => {
        const at = Number(seconds);
        return sha === undefined || !Number.isFinite(at) ? [] : [[sha, at * 1000] as const];
      }),
  );
}

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

/**
 * A worktree's git dir, without spawning git: it is `<worktree>/.git` in the main worktree, and in
 * a linked one that `.git` is a file naming the real dir (`<main>/.git/worktrees/<name>`).
 */
function gitDirOf(worktreePath: string) {
  const dotGit = `${worktreePath}/.git`;
  try {
    if (statSync(dotGit).isDirectory()) {
      return dotGit;
    }
    const pointer = readFileSync(dotGit, "utf8").trim();
    return pointer.startsWith("gitdir: ") ? pointer.slice("gitdir: ".length) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * When git last moved HEAD here: a commit, checkout, reset, rebase, or the worktree's own creation.
 * The reflog's mtime answers all of them for the price of a stat, and unlike `index` it is never
 * rewritten by a `git status`, so stet's own polling cannot fake activity into it. Zero when the
 * repository has reflogs turned off, where the HEAD commit time is the floor instead.
 */
function reflogMtime(worktreePath: string) {
  const gitDir = gitDirOf(worktreePath);
  if (gitDir === undefined) {
    return 0;
  }
  try {
    return statSync(`${gitDir}/logs/HEAD`).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * The most recent of everything that counts as work in a worktree: an uncommitted edit (a changed
 * file's mtime), and anything git did (the reflog, or HEAD's commit date as the portable floor).
 * Edits alone are not enough: they go to zero the moment an agent commits, which is exactly when it
 * was busiest.
 */
export function summarizeWorktree(
  path: string,
  statusOutput: string,
  commitTimeMs: number | undefined,
): WorktreeSummary {
  // A deleted (or vanished-mid-scan) file stats to 0 and so drops out of the max on its own.
  const newest = parseWorktreeStatusPaths(statusOutput).reduce(
    (max, entry) => Math.max(max, fileMtime(path, entry)),
    Math.max(reflogMtime(path), commitTimeMs ?? 0),
  );
  return { lastActivityAt: newest === 0 ? undefined : newest, path };
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
    next.every((summary) => previous.get(summary.path)?.lastActivityAt === summary.lastActivityAt);

  return unchanged ? previous : new Map(next.map((summary) => [summary.path, summary]));
}

/**
 * Picker order: whatever was touched most recently, so the worktree an agent is working in is the
 * one you land on. The main worktree earns no pin, because it is only the busiest worktree when it
 * actually is. Computed once when the picker opens, never on a summary refresh, so the list cannot
 * reorder under the cursor while it is open.
 */
export function orderWorktrees(
  worktrees: readonly Worktree[],
  summaries: ReadonlyMap<string, WorktreeSummary>,
) {
  const activity = (worktree: Worktree) => summaries.get(worktree.path)?.lastActivityAt ?? 0;

  return worktrees.toSorted((a, b) => activity(b) - activity(a) || a.path.localeCompare(b.path));
}
