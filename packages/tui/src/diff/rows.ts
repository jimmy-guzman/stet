import type { FileDiffMetadata, HunksRenderResult } from "@pierre/diffs";
import { Predicate } from "effect";

import { flattenLineSpans } from "./hast";
import type { RenderSpan } from "./hast";

type DiffLineType = "context" | "add" | "remove";

export type DiffRow =
  // A non-expandable break in the row stream: a git-elided gap the diff has no full
  // Contents for (`⋯ N unmodified lines`), or git's `\ No newline at end of file`.
  | { kind: "separator"; glyph: string; text: string }
  | {
      kind: "line";
      navIndex: number;
      type: DiffLineType;
      oldLine?: number;
      newLine?: number;
      spans: RenderSpan[];
    }
  // A collapsed-region placeholder: a user fold (▸ N lines folded) from
  // `applyCollapsedRegions`, or an expandable git-elided gap (⋯ N unmodified lines)
  // From `rowsFromHunks`, keyed `gap:<hunk index>`. Non-navigable, so the caret
  // Skips it like a separator.
  | {
      kind: "marker";
      regionKind: "fold" | "gap";
      key: string;
      count: number;
      /** A collapsed gap/fold shows its "expand" affordance; an expanded gap shows "hide". */
      collapsed: boolean;
    };

export type DiffLineRow = Extract<DiffRow, { kind: "line" }>;

export interface NavigableLine {
  type: DiffLineType;
  oldLine?: number;
  newLine?: number;
  content: string;
}

export const isLineRow = (row: DiffRow): row is DiffLineRow =>
  row.kind === "line";

const unmodifiedLabel = (count: number) =>
  count === 1 ? "1 unmodified line" : `${count} unmodified lines`;

type AstNode = NonNullable<HunksRenderResult["unifiedContentAST"]>[number];

type Element = Extract<AstNode, { type: "element" }>;

type PropertyValue = Element["properties"][string];

const numberProp = (value: PropertyValue) =>
  Predicate.isNumber(value) ? value : undefined;

// `data-line-index` is "<unified>,<split>"; the unified half is the row's position in
// The whole file's unified stream, which no gap expansion renumbers.
const unifiedIndexOf = (value: PropertyValue) =>
  Predicate.isString(value) ? Number(value.split(",")[0]) : undefined;

/** The gap (keyed by the hunk it precedes) a revealed unchanged line sits in. */
const gapIndexFor = (meta: FileDiffMetadata, newLine: number) => {
  const index = meta.hunks.findIndex((hunk) => hunk.additionStart > newLine);

  return index === -1 ? meta.hunks.length : index;
};

const separatorRow = (data: HunksRenderResult["hunkData"][number]): DiffRow =>
  data.expandable === undefined
    ? { glyph: "⋯", kind: "separator", text: unmodifiedLabel(data.lines) }
    : {
        collapsed: true,
        count: data.lines,
        key: `gap:${data.hunkIndex}`,
        kind: "marker",
        regionKind: "gap",
      };

// A unified line node's side and numbers: `data-line` is the side's own number (the
// New side for context), `data-alt-line` the old side's number on a context row.
const lineSides = (props: Element["properties"]) => {
  const line = numberProp(props["data-line"]);

  if (props["data-line-type"] === "change-deletion") {
    return { oldLine: line, type: "remove" as const };
  }

  if (props["data-line-type"] === "change-addition") {
    return { newLine: line, type: "add" as const };
  }

  return {
    newLine: line,
    oldLine: numberProp(props["data-alt-line"]),
    type: "context" as const,
  };
};

/**
 * Turn `DiffHunksRenderer`'s unified row stream into stet's rows. The renderer owns which lines
 * exist for the current gap expansion; this reads each node's line type and numbers off its data
 * attributes and flattens its highlighted HAST into spans. A separator is a collapsed gap marker
 * when the diff carries full contents (`hunkData.expandable`), else a plain separator, and a run of
 * revealed lines is headed by its gap's "hide" marker so `z` can collapse it again. Line rows carry
 * a contiguous `navIndex`. Body (line) rows are capped at `maxLines` unless `full`: `cutoff` is the
 * unified index of the last kept line (from the unexpanded layout), so revealing a gap above the
 * cap never pulls more of the file in below it.
 */
export const rowsFromHunks = (
  meta: FileDiffMetadata,
  result: Pick<HunksRenderResult, "hunkData" | "unifiedContentAST">,
  expanded: ReadonlySet<string>,
  cutoff: number | undefined
) => {
  const rows: DiffRow[] = [];
  let navIndex = 0;
  let separatorOrdinal = 0;
  let openGap: Extract<DiffRow, { kind: "marker" }> | undefined;

  for (const node of result.unifiedContentAST ?? []) {
    if (node.type !== "element") {
      continue;
    }

    const props = node.properties;

    if ("data-separator" in props) {
      const data = result.hunkData[separatorOrdinal];
      separatorOrdinal += 1;
      openGap = undefined;

      if (data === undefined) {
        continue;
      }

      rows.push(separatorRow(data));
      continue;
    }

    if ("data-no-newline" in props) {
      rows.push({
        glyph: "\\",
        kind: "separator",
        text: "No newline at end of file",
      });
      continue;
    }

    const unified = unifiedIndexOf(props["data-line-index"]);

    if (cutoff !== undefined && unified !== undefined && unified > cutoff) {
      break;
    }

    const line = numberProp(props["data-line"]);

    if (props["data-line-type"] === "context-expanded" && line !== undefined) {
      const key = `gap:${gapIndexFor(meta, line)}`;

      if (expanded.has(key) && openGap?.key !== key) {
        openGap = {
          collapsed: false,
          count: 0,
          key,
          kind: "marker",
          regionKind: "gap",
        };
        rows.push(openGap);
      }

      if (openGap?.key === key) {
        openGap.count += 1;
      }
    } else {
      openGap = undefined;
    }

    rows.push({
      kind: "line",
      navIndex,
      spans: flattenLineSpans(node),
      ...lineSides(props),
    });
    navIndex += 1;
  }

  return rows;
};

const isBodyLine = (node: AstNode): node is Element =>
  node.type === "element" &&
  "data-line-index" in node.properties &&
  !("data-no-newline" in node.properties);

/**
 * Where the `maxLines` cap cuts the unexpanded layout: the unified index of the last kept body line
 * (`undefined` when the diff fits) and how many body lines it hides. Measured once, without gap
 * expansion, so the cap is a fixed point in the file.
 */
export const capCutoff = (
  result: Pick<HunksRenderResult, "unifiedContentAST">,
  maxLines: number
) => {
  const body = (result.unifiedContentAST ?? []).filter(isBodyLine);

  return body.length > maxLines
    ? {
        cutoff: unifiedIndexOf(
          body[maxLines - 1]?.properties["data-line-index"]
        ),
        hiddenLines: body.length - maxLines,
      }
    : { cutoff: undefined, hiddenLines: 0 };
};

/** The navigable (cursorable) lines in order; `navIndex` equals array position. */
export const navigableLinesFromRows = (rows: DiffRow[]): NavigableLine[] =>
  rows
    .values()
    .filter(isLineRow)
    .map((row) => ({
      content: row.spans.map((span) => span.text).join(""),
      newLine: row.newLine,
      oldLine: row.oldLine,
      type: row.type,
    }))
    .toArray();
