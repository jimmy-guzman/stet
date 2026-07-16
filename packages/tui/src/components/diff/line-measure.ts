import { TextBuffer, TextBufferView } from "@opentui/core";
import type { WidthMethod } from "@opentui/core";

// Exact wrapped-line measurement: a reusable native TextBufferView measures how
// Many terminal rows a line occupies under word wrap, via the same engine call
// (measureForDimensions) the renderable's own layout uses, so windowing spacers
// And cursor-follow match the rendered height instead of estimating it. One
// Scratch view is reused across all rows; the width method must mirror the
// Renderer's so column widths agree with what is painted.
const LARGE_HEIGHT = 1 << 24;

export function createLineMeasurer(widthMethod: WidthMethod) {
  const buffer = TextBuffer.create(widthMethod);
  const view = TextBufferView.create(buffer);
  view.setWrapMode("word");

  return {
    destroy() {
      view.destroy();
      buffer.destroy();
    },
    measure(text: string, width: number) {
      buffer.setText(text);
      const result = view.measureForDimensions(Math.max(1, width), LARGE_HEIGHT);
      return Math.max(1, result?.lineCount ?? 1);
    },
    offsetForVisualRow(text: string, width: number, visualRow: number) {
      const wrapWidth = Math.max(1, width);
      buffer.setText(text);
      view.setWrapWidth(wrapWidth);
      view.measureForDimensions(wrapWidth, LARGE_HEIGHT);
      return view.lineInfo.lineStartCols[Math.max(0, Math.floor(visualRow))] ?? 0;
    },
  };
}
