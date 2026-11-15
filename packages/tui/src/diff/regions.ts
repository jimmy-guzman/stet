import { navigableLinesFromRows } from "./rows";
import type { DiffRow, NavigableLine } from "./rows";

/**
 * A collapsible region computed from indentation: a header line whose following lines are more
 * indented. `headerNavIndex`/`endNavIndex` are positions in the navigable (line-only) list the
 * region is computed over; `count` is the body line count hidden when the region folds (the header
 * stays). The `key` is side-qualified by the header's own line number so it survives the phase-1 ->
 * phase-2 highlight swap and matches whether it is computed over the raw or the collapsed set.
 */
export interface FoldRegion {
  key: string;
  headerNavIndex: number;
  endNavIndex: number;
  count: number;
}

export const foldKey = (line: NavigableLine) =>
  line.newLine === undefined
    ? `fold:o${line.oldLine}`
    : `fold:n${line.newLine}`;

const indentWidth = (content: string) =>
  content.length - content.trimStart().length;

const isBlank = (content: string) => content.trim().length === 0;

/**
 * Indent-based fold regions over a navigable line list. Every non-blank line whose following
 * non-blank lines are more indented heads a region running to the last such line (interior blanks
 * fold with it, trailing blanks do not). Nesting falls out naturally: an inner block heads its own
 * region inside its parent's. Pure and language-agnostic, mirroring `flattenTree`.
 */
export const computeFoldRegions = (
  navigable: NavigableLine[]
): FoldRegion[] => {
  const regions: FoldRegion[] = [];

  for (let index = 0; index < navigable.length; index += 1) {
    const header = navigable[index];

    if (header === undefined || isBlank(header.content)) {
      continue;
    }

    const headerIndent = indentWidth(header.content);
    let end = index;

    for (let scan = index + 1; scan < navigable.length; scan += 1) {
      const scanned = navigable[scan];

      if (scanned === undefined) {
        break;
      }

      if (isBlank(scanned.content)) {
        continue;
      }

      if (indentWidth(scanned.content) > headerIndent) {
        end = scan;
        continue;
      }

      break;
    }

    if (end > index) {
      regions.push({
        count: end - index,
        endNavIndex: end,
        headerNavIndex: index,
        key: foldKey(header),
      });
    }
  }

  return regions;
};

const ATX_HEADING = /^ {0,3}(?<hashes>#{1,6})(?:\s|$)/u;
const CODE_FENCE = /^ {0,3}(?:```|~~~)/u;

const headingLevel = (content: string) =>
  ATX_HEADING.exec(content)?.groups?.hashes.length ?? 0;

/**
 * Heading-based fold regions for markdown. A section headed by an ATX heading (`#`..`######`) folds
 * down to the last line before the next heading of the same or higher level (or the end); nesting
 * falls out the same way indent regions nest. Fences are tracked so a `#` inside a code block is
 * not read as a heading. Same `FoldRegion`/`foldKey` shape as `computeFoldRegions`, so every caller
 * and the fold `Set` are unchanged. Indent-based folding does almost nothing here (markdown sits at
 * column 0), so this is the language-aware alternative.
 */
export const computeMarkdownFoldRegions = (
  navigable: NavigableLine[]
): FoldRegion[] => {
  const inFence: boolean[] = [];
  let fenced = false;

  for (let index = 0; index < navigable.length; index += 1) {
    inFence[index] = fenced;

    if (CODE_FENCE.test(navigable[index]?.content ?? "")) {
      fenced = !fenced;
    }
  }

  const levelAt = (index: number) => {
    const line = navigable[index];

    return line === undefined || inFence[index]
      ? 0
      : headingLevel(line.content);
  };

  const regions: FoldRegion[] = [];

  for (let index = 0; index < navigable.length; index += 1) {
    const level = levelAt(index);

    if (level === 0) {
      continue;
    }

    let end = index;

    for (let scan = index + 1; scan < navigable.length; scan += 1) {
      const scanLevel = levelAt(scan);

      if (scanLevel > 0 && scanLevel <= level) {
        break;
      }

      end = scan;
    }

    // Trailing blank lines belong to the gap before the next heading, not the section.
    while (end > index && isBlank(navigable[end]?.content ?? "")) {
      end -= 1;
    }

    const header = navigable[index];

    if (end > index && header !== undefined) {
      regions.push({
        count: end - index,
        endNavIndex: end,
        headerNavIndex: index,
        key: foldKey(header),
      });
    }
  }

  return regions;
};

export type FoldMode = "indent" | "markdown";

/** Pick the region model for a file's language: heading-based for markdown, else indentation. */
export const foldRegionsFor = (navigable: NavigableLine[], mode: FoldMode) =>
  mode === "markdown"
    ? computeMarkdownFoldRegions(navigable)
    : computeFoldRegions(navigable);

const nextLineRow = (rows: DiffRow[], from: number) => {
  let index = from;

  while (index < rows.length && rows[index]?.kind !== "line") {
    index += 1;
  }

  const row = rows[index];

  return row?.kind === "line" ? row : undefined;
};

interface ApplyOptions {
  folded: ReadonlySet<string>;
  mode?: FoldMode;
}

/**
 * Fold the row stream for the current state: drop each folded body behind a fold marker.
 * `navIndex` is re-densified over the surviving line rows and `navigable` rebuilt, so the caret
 * indexes only visible lines and can never land inside a folded region. Gap markers and separators
 * (from the engine's layout) pass through, except one that sits inside a folded body (a fold
 * spanning an elided middle, edits at both ends of a block), which hides with it.
 */
export const applyCollapsedRegions = (
  rows: DiffRow[],
  options: ApplyOptions
) => {
  const foldedRegions = foldRegionsFor(
    navigableLinesFromRows(rows),
    options.mode ?? "indent"
  ).filter((region) => options.folded.has(region.key));

  const regionByHeader = new Map(
    foldedRegions.map((region) => [region.headerNavIndex, region])
  );

  const out: DiffRow[] = [];
  let navIndex = 0;
  let skipUntil = -1;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];

    if (row === undefined) {
      continue;
    }

    if (row.kind !== "line") {
      const following = nextLineRow(rows, index + 1);

      if (following === undefined || following.navIndex > skipUntil) {
        out.push(row);
      }

      continue;
    }

    if (row.navIndex <= skipUntil) {
      continue;
    }

    out.push({ ...row, navIndex });
    navIndex += 1;

    const region = regionByHeader.get(row.navIndex);

    if (region !== undefined) {
      out.push({
        collapsed: true,
        count: region.count,
        key: region.key,
        kind: "marker",
        regionKind: "fold",
      });
      skipUntil = region.endNavIndex;
    }
  }

  return { navigable: navigableLinesFromRows(out), rows: out };
};

/**
 * After a toggle changes which lines are navigable, keep the caret on the same file line; if that
 * line was hidden by a fold, fall back to the nearest visible line above it (the fold header). Same
 * "store as a file line, map it back" idea the navigation history uses.
 */
export const remapCursorAfterToggle = (
  previous: NavigableLine[],
  cursorIndex: number,
  next: NavigableLine[]
) => {
  const anchor = previous[cursorIndex];

  if (anchor === undefined) {
    return Math.max(0, Math.min(cursorIndex, next.length - 1));
  }

  const sameLine = (line: NavigableLine) =>
    anchor.newLine === undefined
      ? line.oldLine === anchor.oldLine && line.newLine === undefined
      : line.newLine === anchor.newLine;

  const exact = next.findIndex(sameLine);

  if (exact !== -1) {
    return exact;
  }

  const anchorKey = anchor.newLine ?? anchor.oldLine ?? 0;
  let fallback = 0;

  for (let index = 0; index < next.length; index += 1) {
    const line = next[index];

    if (line === undefined) {
      continue;
    }

    if ((line.newLine ?? line.oldLine ?? 0) <= anchorKey) {
      fallback = index;
      continue;
    }

    break;
  }

  return fallback;
};
