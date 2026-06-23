import type { RenderSpan } from "./hast";

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
