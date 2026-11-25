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

/**
 * Both end glyphs are included, as a terminal's own selection includes them. The endpoints are
 * clamped before they are ordered: two that clamp onto one line can swap.
 */
export const selectedRange = (
  lines: readonly SelectableLine[],
  { anchor, focus, unit }: Selection
): SelectedRange | undefined => {
  if (lines.length === 0) {
    return undefined;
  }

  const clampPoint = ({ column, index }: SelectionPoint) => ({
    column,
    index: clamp(index, lines.length - 1),
  });

  const ends = [clampPoint(anchor), clampPoint(focus)] as const;
  const [first, second] = isBefore(...ends) ? ends : [ends[1], ends[0]];

  return {
    end: {
      column: unitAt(lines[second.index]?.content ?? "", second.column, unit)
        .end,
      index: second.index,
    },
    start: {
      column: unitAt(lines[first.index]?.content ?? "", first.column, unit)
        .start,
      index: first.index,
    },
  };
};

const sameText = (
  a: SelectableLine | undefined,
  b: SelectableLine | undefined
) => a !== undefined && a.content === b?.content;

/** How many leading lines the two have in common, up to `limit`. */
const commonLines = (
  a: readonly SelectableLine[],
  b: readonly SelectableLine[],
  limit: number
) => {
  let count = 0;

  while (count < limit && sameText(a[count], b[count])) {
    count += 1;
  }

  return count;
};

/** Where a run of lines now starts, nearest to where it was; undefined when it is nowhere. */
const nearestRun = (
  lines: readonly SelectableLine[],
  run: readonly SelectableLine[],
  from: number
) => {
  const starts = lines.flatMap((_, start) =>
    run.every((line, offset) => sameText(line, lines[start + offset]))
      ? [start]
      : []
  );

  return starts.toSorted((a, b) => Math.abs(a - from) - Math.abs(b - from))[0];
};

/**
 * Keep a selection on its text when a refresh changes the lines under it: text before the first
 * changed line stays, text after the last one moves with the length, and text between is looked for.
 *
 * @returns The selection, moved if need be; undefined when its lines are gone or edited.
 */
export const followLines = (
  previous: readonly SelectableLine[],
  next: readonly SelectableLine[],
  selection: Selection
): Selection | undefined => {
  const range = selectedRange(previous, selection);

  if (range === undefined) {
    return undefined;
  }

  const { start, end } = range;
  const shared = Math.min(previous.length, next.length);
  const before = commonLines(previous, next, shared);

  if (end.index < before) {
    return selection;
  }

  const after = commonLines(
    previous.toReversed(),
    next.toReversed(),
    shared - before
  );

  const moved =
    start.index >= previous.length - after
      ? start.index + next.length - previous.length
      : nearestRun(
          next,
          previous.slice(start.index, end.index + 1),
          start.index
        );

  if (moved === undefined) {
    return undefined;
  }

  const move = ({ column, index }: SelectionPoint) => ({
    column,
    index: index + moved - start.index,
  });

  return {
    ...selection,
    anchor: move(selection.anchor),
    focus: move(selection.focus),
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
