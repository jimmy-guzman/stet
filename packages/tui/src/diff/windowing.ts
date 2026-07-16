// Pure viewport windowing: given the scroll offset and viewport height, return
// The slice of rows to mount plus the spacer heights that stand in for the
// Skipped rows above and below, so total scroll height is preserved while only
// Visible rows are rendered. Mounting only the visible slice (rather than all
// Rows) is what keeps layout cost viewport-bounded and avoids the eager
// Whole-diff layout that wedged OpenTUI's scheduler.

export interface VisibleWindow {
  /** First mounted row index, inclusive. */
  start: number;
  /** Last mounted row index, exclusive. */
  end: number;
  /** Terminal rows skipped before the first mounted row. */
  topSpacer: number;
  /** Terminal rows skipped after the last mounted row. */
  bottomSpacer: number;
}

const EMPTY: VisibleWindow = { bottomSpacer: 0, end: 0, start: 0, topSpacer: 0 };

/** Cumulative terminal-row end offset for each source row. */
export function cumulativeRowEnds(heights: readonly number[]) {
  let total = 0;
  return heights.map((height) => {
    total += Math.max(0, height);
    return total;
  });
}

/** Row containing a zero-based terminal-cell offset, or undefined outside the content. */
export function rowIndexAtOffset(ends: readonly number[], offset: number) {
  const total = ends.at(-1) ?? 0;
  if (!Number.isFinite(offset) || offset < 0 || offset >= total) {
    return undefined;
  }

  const cell = Math.floor(offset);
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
}

/** Fast path: every row is one terminal row tall (unified, no wrap). */
export function visibleWindow(
  rowCount: number,
  scrollTop: number,
  viewportHeight: number,
  overscan = 0,
): VisibleWindow {
  if (rowCount <= 0) {
    return EMPTY;
  }

  const top = Math.max(0, Math.floor(scrollTop));
  const start = Math.max(0, top - overscan);
  const end = Math.min(rowCount, top + Math.max(0, viewportHeight) + overscan);
  const clampedEnd = Math.max(start, end);

  return {
    bottomSpacer: rowCount - clampedEnd,
    end: clampedEnd,
    start,
    topSpacer: start,
  };
}

/** Variable path: `heights[i]` is row i's terminal-row height (wrap mode). */
export function visibleWindowVariable(
  heights: number[],
  scrollTop: number,
  viewportHeight: number,
  overscan = 0,
): VisibleWindow {
  const count = heights.length;
  if (count <= 0) {
    return EMPTY;
  }

  const tops: number[] = [];
  let total = 0;
  for (const height of heights) {
    tops.push(total);
    total += Math.max(0, height);
  }

  const top = Math.max(0, Math.min(Math.floor(scrollTop), Math.max(0, total - 1)));
  const bottom = top + Math.max(0, viewportHeight);

  let first = -1;
  let last = -1;
  for (let index = 0; index < count; index += 1) {
    const height = Math.max(0, heights[index] ?? 0);
    if (height === 0) {
      continue;
    }
    const rowTop = tops[index] ?? 0;
    if (rowTop + height > top && rowTop < bottom) {
      if (first === -1) {
        first = index;
      }
      last = index;
    }
  }

  if (first === -1) {
    return { bottomSpacer: 0, end: count, start: count, topSpacer: total };
  }

  const start = Math.max(0, first - overscan);
  const end = Math.min(count, last + 1 + overscan);
  const lastTop = tops[end - 1] ?? 0;
  const lastHeight = Math.max(0, heights[end - 1] ?? 0);

  return {
    bottomSpacer: Math.max(0, total - (lastTop + lastHeight)),
    end,
    start,
    topSpacer: tops[start] ?? 0,
  };
}
