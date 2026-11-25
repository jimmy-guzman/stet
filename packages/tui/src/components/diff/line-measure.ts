import { TextBuffer, TextBufferView } from "@opentui/core";
import type { NativeResourceOwner, WidthMethod } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { createMemo, onCleanup } from "solid-js";

import { widthMethod } from "@/diff/cells";

// Exact wrapped-line measurement: a reusable native TextBufferView measures how
// Many terminal rows a line occupies under word wrap, via the same engine call
// (measureForDimensions) the renderable's own layout uses, so the
// Viewer's row offsets and the help list's height match what is rendered instead of estimating it. One
// Scratch view is reused across all rows; the width method must mirror the
// Renderer's so column widths agree with what is painted.
const LARGE_HEIGHT = 2 ** 24;

export const createLineMeasurer = (
  method: WidthMethod,
  owner: NativeResourceOwner
) => {
  const buffer = TextBuffer.create(method, owner);
  const view = TextBufferView.create(buffer);
  view.setWrapMode("word");

  // The display column each wrapped row of a line starts at.
  const rowStarts = (text: string, width: number) => {
    const wrapWidth = Math.max(1, width);
    buffer.setText(text);
    view.setWrapWidth(wrapWidth);
    view.measureForDimensions(wrapWidth, LARGE_HEIGHT);

    return view.lineInfo.lineStartCols;
  };

  return {
    destroy() {
      view.destroy();
      buffer.destroy();
    },
    measure(text: string, width: number) {
      buffer.setText(text);

      const result = view.measureForDimensions(
        Math.max(1, width),
        LARGE_HEIGHT
      );

      return Math.max(1, result?.lineCount ?? 1);
    },
    offsetForVisualRow(text: string, width: number, visualRow: number) {
      return rowStarts(text, width)[Math.max(0, Math.floor(visualRow))] ?? 0;
    },
    visualRowForOffset(text: string, width: number, column: number) {
      return Math.max(
        0,
        rowStarts(text, width).findLastIndex((start) => start <= column)
      );
    },
  };
};

/**
 * A measurer for the calling component. It is remade when the terminal's width method changes, so
 * wrapped rows and pointer columns are always measured the one way.
 */
export const useLineMeasurer = () => {
  const renderer = useRenderer();

  return createMemo(() => {
    const measurer = createLineMeasurer(widthMethod(), renderer.nativeScene);

    onCleanup(() => {
      measurer.destroy();
    });

    return measurer;
  });
};
