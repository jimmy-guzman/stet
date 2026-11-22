import type { FileContent } from "./file/content";
import type { ChangedFile } from "./git/model";
import type { Worktree } from "./git/worktree";

// The right-side stats for the active file: line count in full-file view, the
// Add/remove counts (plus any warnings) in diff view. The diff/file mode is left
// Implicit, since `N lines` vs `+A -D` already says which it is.
export const viewerStats = (
  selectedFile: ChangedFile | undefined,
  showFileContent: boolean,
  fileContent: FileContent | undefined
) => {
  if (showFileContent) {
    return fileContent?.kind === "text"
      ? `${fileContent.lineCount} lines${fileContent.truncated ? " (truncated)" : ""}`
      : "";
  }

  if (selectedFile === undefined) {
    return "";
  }

  const warnings =
    selectedFile.warnings.length === 0
      ? ""
      : ` !${selectedFile.warnings.join(",")}`;

  if (selectedFile.binary) {
    return `binary${warnings}`;
  }

  // A zero side says nothing, so an added file reads `+38`, not `+38 -0`.
  const counts = [
    selectedFile.additions === 0 ? "" : `+${selectedFile.additions}`,
    selectedFile.deletions === 0 ? "" : `-${selectedFile.deletions}`,
  ]
    .filter((part) => part !== "")
    .join(" ");

  return `${counts}${warnings}`.trim();
};

export const worktreeLabel = (worktree: Worktree) =>
  worktree.branch ?? `${worktree.head.slice(0, 7)} (detached)`;

export const placeholderText = (content: FileContent | undefined) => {
  if (content === undefined) {
    return "";
  }

  if (content.kind === "binary") {
    return "binary file";
  }

  if (content.kind === "too-large") {
    return `too large (${Math.round(content.bytes / 1024)}kb) · f to load`;
  }

  return "file not found";
};

const KIND_LETTER: Record<ChangedFile["kind"], string> = {
  added: "A",
  deleted: "D",
  modified: "M",
  renamed: "R",
  untracked: "U",
};

export const kindLetter = (kind: ChangedFile["kind"]) => KIND_LETTER[kind];

export const nearestNavigableIndex = (
  lines: { newLine?: number; oldLine?: number }[],
  target: number
) => {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const [index, line] of lines.entries()) {
    const reference = line.newLine ?? line.oldLine;

    if (reference === undefined) {
      continue;
    }

    const distance = Math.abs(reference - target);

    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }

  return best;
};
