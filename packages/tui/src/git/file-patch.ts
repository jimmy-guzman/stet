import { lstat, readFile, readlink } from "node:fs/promises";

import type { DiffScope } from "@/cli";
import { imageMeta } from "@/file/image-meta";
import type { ImageMeta } from "@/file/image-meta";

import type { ChangedFile } from "./model";

/**
 * One endpoint of a per-file comparison: a git object (`ref:path` / `:path`), the worktree file, or
 * nothing (the fabricated side of an add or delete).
 */
export type PatchSide =
  | { kind: "git"; spec: string }
  | { kind: "worktree" }
  | { kind: "empty" };

export type SideContent =
  | { kind: "text"; text: string }
  | { kind: "binary"; bytes: number; image?: ImageMeta }
  | { kind: "too-large" }
  | { kind: "missing" };

/** One side of an in-process diff: its repo-relative path and full text. */
interface DiffFile {
  name: string;
  contents: string;
}

/**
 * What the diff engine renders: a patch git printed (the fallback, binary, and untracked paths), or
 * both files' full text, which the engine diffs itself. Only the files carry the unchanged lines a
 * gap reveals: git's patch runs through textconv and clean filters, which can renumber or rewrite
 * lines, so raw bytes beside it would fill its gaps with the wrong text. A side is `null` when it is
 * the empty side of an add or delete.
 */
export type DiffInput =
  | { patch: string }
  | { files: { oldFile: DiffFile | null; newFile: DiffFile | null } };

/** A binary side's size and (for a recognized image) pixel dimensions, for the viewer placeholder. */
export interface SideMeta {
  bytes: number;
  image?: ImageMeta;
}

/**
 * Both endpoints' binary metadata for a changed binary file; a side is absent when it is the empty
 * side of an add/delete.
 */
export interface BinaryDiff {
  oldSide?: SideMeta;
  newSide?: SideMeta;
}

/**
 * A fetched side's binary metadata, or `undefined` when the side is not binary (the fabricated
 * empty side of an add/delete, which classifies as empty text, and thus has no size to show).
 */
export const sideMeta = (content: SideContent): SideMeta | undefined =>
  content.kind === "binary"
    ? { bytes: content.bytes, image: content.image }
    : undefined;

// Sides above this size are not decoded or diffed in-process; the git fallback
// Handles them as it always has. 10x the viewer's own file cap: generous enough
// That real source files never fall back, small enough to never diff a giant
// Artifact on the render path.
const MAX_SIDE_BYTES = 10_000_000;

// Myers costs O((N+M)·D) and @pierre/patches runs it synchronously with no
// Deadline, so the cost is bounded before diffing instead. Measured on a full
// Rewrite: 4e8 units takes about 1s, the budget jsdiff's timeout used to enforce.
const MAX_DIFF_COST = 400_000_000;

const emptySide: PatchSide = { kind: "empty" };

/**
 * Which two endpoints the scope's `git diff` invocation would compare for this file. `file.stage`
 * is deliberately not consulted: membership in the scope's changed set (built from the same `git
 * diff` arguments) already encodes it, exactly as the pathspec invocation relied on.
 */
export const fileDiffSides = (scope: DiffScope, file: ChangedFile) => {
  const base = (path: string): PatchSide =>
    scope.kind === "unstaged"
      ? { kind: "git", spec: `:${path}` }
      : { kind: "git", spec: `${scope.ref}:${path}` };

  const target = (): PatchSide => {
    if (scope.kind === "staged") {
      return { kind: "git", spec: `:${file.path}` };
    }

    if (scope.kind === "last-commit" || scope.kind === "commit") {
      return { kind: "git", spec: `${scope.headRef ?? "HEAD"}:${file.path}` };
    }

    return { kind: "worktree" };
  };

  return {
    newSide: file.kind === "deleted" ? emptySide : target(),
    oldSide:
      file.kind === "added" || file.kind === "untracked"
        ? emptySide
        : base(file.oldPath ?? file.path),
  };
};

const decoder = new TextDecoder();

/**
 * Byte classification for a diff side. Deliberately not `classifyFileBytes`: that path truncates
 * oversized/long files and strips the trailing newline, either of which would fabricate diff
 * content (a truncated side reads as deletions, a stripped newline breaks the `\ No newline at end
 * of file` marker).
 */
export const classifySideBytes = (bytes: Uint8Array): SideContent => {
  if (bytes.byteLength > MAX_SIDE_BYTES) {
    return { kind: "too-large" };
  }

  if (bytes.subarray(0, 8000).includes(0)) {
    return { bytes: bytes.byteLength, image: imageMeta(bytes), kind: "binary" };
  }

  return { kind: "text", text: decoder.decode(bytes) };
};

/**
 * The worktree endpoint, read raw. A symlink reads as its target path text (git's blob form for a
 * link); a directory or vanished path is `missing`, which sends the caller to the git fallback.
 */
export const readWorktreeSide = async (
  repoRoot: string,
  path: string
): Promise<SideContent> => {
  const absolutePath = `${repoRoot}/${path}`;

  try {
    const stat = await lstat(absolutePath);

    if (stat.isSymbolicLink()) {
      return { kind: "text", text: await readlink(absolutePath) };
    }

    if (!stat.isFile()) {
      return { kind: "missing" };
    }

    if (stat.size > MAX_SIDE_BYTES) {
      return { kind: "too-large" };
    }

    return classifySideBytes(await readFile(absolutePath));
  } catch {
    return { kind: "missing" };
  }
};

const newlinesBetween = (text: string, from: number, to: number) => {
  let count = 0;

  for (
    let index = text.indexOf("\n", from);
    index !== -1 && index < to;
    index = text.indexOf("\n", index + 1)
  ) {
    count += 1;
  }

  return count;
};

/**
 * An upper bound on the diff's edit distance `D` for edits clustered in one place. Every line
 * inside the common leading and trailing characters is unchanged, so only the lines between them
 * can be edits.
 */
const trimmedBound = (oldText: string, newText: string) => {
  const limit = Math.min(oldText.length, newText.length);
  let prefix = 0;

  while (prefix < limit && oldText[prefix] === newText[prefix]) {
    prefix += 1;
  }

  let suffix = 0;

  while (
    suffix < limit - prefix &&
    oldText[oldText.length - 1 - suffix] ===
      newText[newText.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  return (
    newlinesBetween(oldText, prefix, oldText.length - suffix) +
    newlinesBetween(newText, prefix, newText.length - suffix) +
    2
  );
};

const lineCounts = (lines: string[]) => {
  const counts = new Map<string, number>();

  for (const line of lines) {
    counts.set(line, (counts.get(line) ?? 0) + 1);
  }

  return counts;
};

/**
 * Lines matched from both ends of the gap between two matched pairs (exclusive), walking inward
 * while the two sides agree.
 */
const gapMatches = (
  oldLines: string[],
  newLines: string[],
  from: readonly [number, number],
  to: readonly [number, number]
) => {
  let oldStart = from[0] + 1;
  let newStart = from[1] + 1;

  while (
    oldStart < to[0] &&
    newStart < to[1] &&
    oldLines[oldStart] === newLines[newStart]
  ) {
    oldStart += 1;
    newStart += 1;
  }

  let oldEnd = to[0] - 1;
  let newEnd = to[1] - 1;

  while (
    oldEnd >= oldStart &&
    newEnd >= newStart &&
    oldLines[oldEnd] === newLines[newEnd]
  ) {
    oldEnd -= 1;
    newEnd -= 1;
  }

  return oldStart - from[0] - 1 + (to[0] - 1 - oldEnd);
};

/**
 * An upper bound on `D` for edits spread through the file, where the trimmed middle is the whole
 * file. Any common subsequence of length `L` gives `D <= N + M - 2L`, and this builds patience
 * diff's: the lines that occur exactly once on each side, longest run kept in order (patience
 * sorting), then the equal lines at either end of each gap between them, which picks up the
 * repeated lines (`}`, blank lines) that cannot be anchors.
 */
const anchoredBound = (oldText: string, newText: string) => {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const oldCounts = lineCounts(oldLines);
  const newCounts = lineCounts(newLines);

  const anchorIndex = new Map(
    newLines
      .entries()
      .filter(
        ([, line]) => oldCounts.get(line) === 1 && newCounts.get(line) === 1
      )
      .map(([index, line]) => [line, index])
  );

  const anchors = oldLines
    .entries()
    .flatMap(([oldIndex, line]) => {
      const newIndex = anchorIndex.get(line);

      return newIndex === undefined ? [] : [[oldIndex, newIndex] as const];
    })
    .toArray();

  // `tails[k]` is the anchor ending the best run of length k + 1; `previous` links
  // Each anchor to the one before it in its run.
  const tails: number[] = [];
  const previous: number[] = [];

  for (const [index, [, newIndex]] of anchors.entries()) {
    let low = 0;
    let high = tails.length;

    while (low < high) {
      const middle = Math.floor((low + high) / 2);

      if ((anchors[tails[middle] ?? 0]?.[1] ?? newIndex) < newIndex) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }

    previous[index] = low === 0 ? -1 : (tails[low - 1] ?? -1);
    tails[low] = index;
  }

  // Walked back to front, then reversed once: `unshift` per anchor moves the whole
  // Array each time, which made 100k unique lines take ~1s instead of ~130ms.
  const chain: (readonly [number, number])[] = [];

  for (
    let index = tails.at(-1) ?? -1;
    index !== -1;
    index = previous[index] ?? -1
  ) {
    const anchor = anchors[index];

    if (anchor !== undefined) {
      chain.push(anchor);
    }
  }

  chain.reverse();
  chain.push([oldLines.length, newLines.length]);

  let matched = chain.length - 1;
  let from: readonly [number, number] = [-1, -1];

  for (const to of chain) {
    matched += gapMatches(oldLines, newLines, from, to);
    from = to;
  }

  return oldLines.length + newLines.length - 2 * matched;
};

/**
 * Whether the diff's worst-case cost `(N+M)·D` fits the budget, with `D` bounded from the text
 * alone: numstat can be stale by the time a side is read, and an index side can change under it.
 * The anchored bound costs a pass over every line, so it runs only when the trimmed one is not
 * enough.
 */
const withinBudget = (oldText: string, newText: string) => {
  const lines =
    newlinesBetween(oldText, 0, oldText.length) +
    newlinesBetween(newText, 0, newText.length) +
    2;

  return (
    lines * trimmedBound(oldText, newText) <= MAX_DIFF_COST ||
    lines * anchoredBound(oldText, newText) <= MAX_DIFF_COST
  );
};

/**
 * The engine's input for one changed file, built from its two sides' contents, or `undefined` for
 * the git fallback when an in-process diff could not be faithful to what `git diff` would print or
 * could not be bounded: a side that is missing or oversized, CRLF on exactly one side (git may be
 * eol-converting the worktree before diffing, so raw bytes would paint a whole-file rewrite),
 * identical text against non-zero numstat counts (an unmodeled content filter), or a worst-case
 * diff cost over budget. Binary sides yield an empty patch: the render is a model-driven
 * placeholder either way, same as git's `Binary files differ` line.
 */
export const buildDiffInput = (
  file: ChangedFile,
  oldContent: SideContent,
  newContent: SideContent
): DiffInput | undefined => {
  if (oldContent.kind === "binary" || newContent.kind === "binary") {
    return { patch: "" };
  }

  if (oldContent.kind !== "text" || newContent.kind !== "text") {
    return undefined;
  }

  const created = file.kind === "added" || file.kind === "untracked";
  const deleted = file.kind === "deleted";

  if (
    !created &&
    !deleted &&
    oldContent.text.includes("\r\n") !== newContent.text.includes("\r\n")
  ) {
    return undefined;
  }

  // Identical text renders no rows (a pure rename, a mode-only change), so there is
  // Nothing to diff and no file text worth holding in the render cache.
  if (oldContent.text === newContent.text) {
    return file.additions + file.deletions > 0 ? undefined : { patch: "" };
  }

  // An empty side is a linear all-add or all-delete diff (100k lines in ~20ms), so
  // Only a two-sided diff can run over budget.
  if (
    oldContent.text !== "" &&
    newContent.text !== "" &&
    !withinBudget(oldContent.text, newContent.text)
  ) {
    return undefined;
  }

  return {
    files: {
      newFile: deleted ? null : { contents: newContent.text, name: file.path },
      oldFile: created
        ? null
        : { contents: oldContent.text, name: file.oldPath ?? file.path },
    },
  };
};
