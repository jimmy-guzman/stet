import type { RenderSpan } from "./hast";

export interface HighlightSpan extends RenderSpan {
  /** Set on the spans inside the caret word so the renderer paints a background. */
  highlight?: boolean;
}

function highlightSpan(fg: string | undefined, text: string, highlight: boolean): HighlightSpan {
  const base = fg === undefined ? { text } : { fg, text };
  return highlight ? { ...base, highlight: true } : base;
}

// Tag the display-column range [from, to) of these spans as highlighted, splitting
// Spans at the boundaries so the caret word can carry a background. Columns are
// Display columns from the start of `spans` (wide glyphs count as two), so the
// Caller passes a window-relative range. A no-op range returns the spans unchanged.
export function markRange(spans: RenderSpan[], from: number, to: number): HighlightSpan[] {
  if (to <= from) {
    return spans;
  }
  const out: HighlightSpan[] = [];
  let col = 0;
  for (const span of spans) {
    let text = "";
    let highlighted = false;
    for (const char of span.text) {
      const inRange = col >= from && col < to;
      if (text !== "" && inRange !== highlighted) {
        out.push(highlightSpan(span.fg, text, highlighted));
        text = "";
      }
      highlighted = inRange;
      text += char;
      col += Bun.stringWidth(char);
    }
    if (text !== "") {
      out.push(highlightSpan(span.fg, text, highlighted));
    }
  }
  return out;
}

// The UTF-16 string index at display column `col` (wide glyphs count as two), for
// Mapping a mouse click back onto a position in the line. A column past the end
// Returns the line length; a column inside a wide glyph returns that glyph's start.
export function columnToIndex(line: string, col: number): number {
  if (col <= 0) {
    return 0;
  }
  let display = 0;
  let index = 0;
  for (const char of line) {
    const charWidth = Bun.stringWidth(char);
    if (display + charWidth > col) {
      return index;
    }
    display += charWidth;
    index += char.length;
  }
  return index;
}

// Slice spans to a horizontal window [start, start+width) in display columns,
// Left-aligned, so the diff can scroll long lines horizontally (shared offset
// Across all lines) while clipping the rest. Wide (CJK) glyphs count as two
// Columns; a glyph straddling either edge is dropped rather than split.
export function sliceSpansWindow(spans: RenderSpan[], start: number, width: number): RenderSpan[] {
  if (width <= 0) {
    return [];
  }

  const end = start + width;
  const out: RenderSpan[] = [];
  let col = 0;
  for (const span of spans) {
    let text = "";
    for (const char of span.text) {
      const charWidth = Bun.stringWidth(char);
      if (col >= start && col + charWidth <= end) {
        text += char;
      }
      col += charWidth;
      if (col >= end) {
        break;
      }
    }
    if (text !== "") {
      out.push(span.fg === undefined ? { text } : { fg: span.fg, text });
    }
    if (col >= end) {
      break;
    }
  }
  return out;
}
