import { graphemeClusters } from "@/utils/text";

import { cellWidth } from "./cells";
import type { RenderSpan } from "./hast";

export interface HighlightSpan extends RenderSpan {
  /** Set on the selected spans so the renderer paints a background. */
  highlight?: boolean;
}

/**
 * Tags the UTF-16 range [from, to) of these spans as highlighted, splitting spans at the boundaries
 * so a selection can carry a background. Offsets count from the start of the line and land on
 * grapheme boundaries, which the selection guarantees. An empty range returns the spans unchanged.
 */
export const markRange = (
  spans: RenderSpan[],
  from: number,
  to: number
): HighlightSpan[] => {
  if (to <= from) {
    return spans;
  }

  let end = 0;

  return spans.flatMap((span) => {
    const start = end;
    end += span.text.length;

    const cut = (at: number) =>
      Math.max(0, Math.min(at - start, span.text.length));

    return [
      { ...span, text: span.text.slice(0, cut(from)) },
      { ...span, highlight: true, text: span.text.slice(cut(from), cut(to)) },
      { ...span, text: span.text.slice(cut(to)) },
    ].filter((part) => part.text !== "");
  });
};

// The UTF-16 string index at display column `col` (wide glyphs count as two), for
// Mapping a mouse click back onto a position in the line. A column past the end
// Returns the line length; a column inside a wide glyph returns that glyph's start.
export const columnToIndex = (line: string, col: number): number => {
  if (col <= 0) {
    return 0;
  }

  let display = 0;
  let index = 0;

  for (const char of graphemeClusters(line)) {
    const charWidth = cellWidth(char);

    if (display + charWidth > col) {
      return index;
    }

    display += charWidth;
    index += char.length;
  }

  return index;
};
