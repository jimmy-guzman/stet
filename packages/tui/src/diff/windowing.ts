// Pure viewport windowing: given the rows' cumulative heights, the scroll offset, and the viewport
// Height, return the slice of rows to mount. Mounting only the visible slice (rather than all rows)
// Keeps mount and layout cost bounded by the viewport instead of the file.

export interface VisibleWindow {
  /** First mounted row index, inclusive. */
  start: number;
  /** Last mounted row index, exclusive. */
  end: number;
  /** The content offset, in terminal rows, of the first mounted row's top. */
  top: number;
}

const EMPTY: VisibleWindow = { end: 0, start: 0, top: 0 };

/** Cumulative terminal-row end offset for each source row. */
export const cumulativeRowEnds = (heights: readonly number[]) => {
  let total = 0;

  return heights.map((height) => {
    total += Math.max(0, height);

    return total;
  });
};

/** Binary search for the first row whose end offset is past `cell`. */
const firstRowEndingAfter = (ends: readonly number[], cell: number) => {
  let low = 0;
  let high = ends.length - 1;

  while (low < high) {
    const middle = Math.floor((low + high) / 2);

    if ((ends[middle] ?? 0) > cell) {
      high = middle;
    } else {
      low = middle + 1;
    }
  }

  return low;
};

/** Row containing a zero-based terminal-cell offset, or undefined outside the content. */
export const rowIndexAtOffset = (ends: readonly number[], offset: number) => {
  const total = ends.at(-1) ?? 0;

  return Number.isFinite(offset) && offset >= 0 && offset < total
    ? firstRowEndingAfter(ends, Math.floor(offset))
    : undefined;
};

/**
 * The slice of rows the viewport shows. The window and the offset it paints at come from the same
 * scroll position, so a frame never shows a row the slice left out.
 */
export const visibleWindow = (
  ends: readonly number[],
  scrollTop: number,
  viewportHeight: number
): VisibleWindow => {
  if (ends.length === 0 || viewportHeight <= 0) {
    return EMPTY;
  }

  const start = firstRowEndingAfter(ends, scrollTop);

  return {
    end: firstRowEndingAfter(ends, scrollTop + viewportHeight - 1) + 1,
    start,
    top: ends[start - 1] ?? 0,
  };
};
