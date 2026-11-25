// The viewer's text selection, as a pure model over its navigable lines (no Solid/Effect/OpenTUI).
// A selection is two glyphs and a unit; everything else (the text, the painted columns, the
// Reference) is derived, clamped against the lines as they are now, so a refresh that shrinks the
// File under a selection can only shrink it.

import { wordAt } from "@/diff/words";
import { graphemeAt } from "@/utils/text";

/** A glyph: a navigable line and the UTF-16 offset it starts at (the line's length is its end). */
export interface SelectionPoint {
  index: number;
  column: number;
}

/** What the endpoints grow to, like a click, a double-click, and a triple-click. */
export type SelectionUnit = "character" | "word" | "line";

export interface Selection {
  anchor: SelectionPoint;
  focus: SelectionPoint;
  unit: SelectionUnit;
}

/** The selected span in document order; `end.column` is exclusive. */
export interface SelectedRange {
  start: SelectionPoint;
  end: SelectionPoint;
}

interface SelectableLine {
  content: string;
  newLine?: number;
  oldLine?: number;
}

const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max));

const isBefore = (a: SelectionPoint, b: SelectionPoint) =>
  a.index < b.index || (a.index === b.index && a.column <= b.column);

/** The span an endpoint grows to on its own line. */
const unitAt = (content: string, column: number, unit: SelectionUnit) => {
  if (unit === "line") {
    return { end: content.length, start: 0 };
  }

  return (
    (unit === "word" ? wordAt(content, column) : undefined) ??
    graphemeAt(content, column)
  );
};

/** Both end glyphs are included, as a terminal's own selection includes them. */
export const selectedRange = (
  lines: readonly SelectableLine[],
  { anchor, focus, unit }: Selection
): SelectedRange | undefined => {
  const last = lines.length - 1;

  if (last < 0) {
    return undefined;
  }

  const [first, second] = isBefore(anchor, focus)
    ? [anchor, focus]
    : [focus, anchor];

  const start = clamp(first.index, last);
  const end = clamp(second.index, last);

  return {
    end: {
      column: unitAt(lines[end]?.content ?? "", second.column, unit).end,
      index: end,
    },
    start: {
      column: unitAt(lines[start]?.content ?? "", first.column, unit).start,
      index: start,
    },
  };
};

/** The selected part of one line, as a UTF-16 range; undefined outside the selection. */
export const selectedColumns = (
  { start, end }: SelectedRange,
  index: number,
  content: string
) =>
  index < start.index || index > end.index
    ? undefined
    : {
        from: index === start.index ? start.column : 0,
        to: index === end.index ? end.column : content.length,
      };

export const selectedText = (
  lines: readonly SelectableLine[],
  range: SelectedRange
) =>
  lines
    .slice(range.start.index, range.end.index + 1)
    .map(({ content }, offset) => {
      const columns = selectedColumns(
        range,
        range.start.index + offset,
        content
      );

      return content.slice(columns?.from, columns?.to);
    })
    .join("\n");

/**
 * The file lines a reference to the range names. A diff mixes sides, so it names the new side's
 * lines, and the old side's only when every selected line was removed.
 */
export const selectedLineNumbers = (
  lines: readonly SelectableLine[],
  { start, end }: SelectedRange
) => {
  const selected = lines.slice(start.index, end.index + 1);
  const added = selected.flatMap(({ newLine }) => newLine ?? []);

  const numbers =
    added.length > 0 ? added : selected.flatMap(({ oldLine }) => oldLine ?? []);

  return { endLine: numbers.at(-1), line: numbers[0] };
};

/** Move the focus one line, keeping its column and unit. */
export const moveFocusRow = (
  lines: readonly SelectableLine[],
  selection: Selection,
  delta: number
): Selection => ({
  ...selection,
  focus: {
    ...selection.focus,
    index: clamp(selection.focus.index + delta, Math.max(0, lines.length - 1)),
  },
});

/**
 * Move the focus one glyph along its line. A whole-line selection has no column to move, so it is
 * left alone; a word selection keeps its ends and continues glyph by glyph, or the move would be
 * absorbed by the word it lands in.
 */
export const moveFocusColumn = (
  lines: readonly SelectableLine[],
  selection: Selection,
  delta: -1 | 1
): Selection => {
  const range = selectedRange(lines, selection);

  if (selection.unit === "line" || range === undefined) {
    return selection;
  }

  const forward = isBefore(selection.anchor, selection.focus);

  const lastGlyph = {
    column: graphemeAt(
      lines[range.end.index]?.content ?? "",
      range.end.column - 1
    ).start,
    index: range.end.index,
  };

  const anchor = forward ? range.start : lastGlyph;
  const focus = forward ? lastGlyph : range.start;
  const content = lines[focus.index]?.content ?? "";
  const glyph = graphemeAt(content, focus.column);

  const moved =
    delta === 1
      ? Math.min(glyph.end, graphemeAt(content, content.length - 1).start)
      : graphemeAt(content, glyph.start - 1).start;

  return {
    anchor,
    focus: { column: moved, index: focus.index },
    unit: "character",
  };
};
