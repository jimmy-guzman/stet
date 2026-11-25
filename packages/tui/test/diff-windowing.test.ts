import { describe, expect, test } from "bun:test";

import {
  cumulativeRowEnds,
  rowIndexAtOffset,
  visibleWindow,
} from "@/diff/windowing";

describe("row offsets", () => {
  test("maps terminal cells through variable-height rows", () => {
    const ends = cumulativeRowEnds([1, 3, 1]);

    expect(ends).toEqual([1, 4, 5]);
    expect(rowIndexAtOffset(ends, 0)).toBe(0);
    expect(rowIndexAtOffset(ends, 1)).toBe(1);
    expect(rowIndexAtOffset(ends, 3)).toBe(1);
    expect(rowIndexAtOffset(ends, 4)).toBe(2);
  });

  test("skips zero-height rows and rejects cells outside the content", () => {
    const ends = cumulativeRowEnds([1, 0, 2]);

    expect(ends).toEqual([1, 1, 3]);
    expect(rowIndexAtOffset(ends, 1)).toBe(2);
    expect(rowIndexAtOffset(ends, -1)).toBeUndefined();
    expect(rowIndexAtOffset(ends, 3)).toBeUndefined();
    expect(rowIndexAtOffset([], 0)).toBeUndefined();
  });
});

describe("visibleWindow", () => {
  const fixed = cumulativeRowEnds(Array.from({ length: 100 }, () => 1));
  // Row0 = 0..1, row1 = 1..4, row2 = 4..5, row3 = 5..7, row4 = 7..8.
  const wrapped = cumulativeRowEnds([1, 3, 1, 2, 1]);

  test("mounts exactly the rows the viewport shows", () => {
    expect(visibleWindow(fixed, 10, 5)).toEqual({
      end: 15,
      start: 10,
      top: 10,
    });
  });

  test("clamps to the row range at the top and bottom", () => {
    expect(visibleWindow(fixed, 0, 5)).toEqual({ end: 5, start: 0, top: 0 });
    expect(visibleWindow(fixed, 98, 5)).toEqual({
      end: 100,
      start: 98,
      top: 98,
    });
  });

  test("selects the wrapped rows that overlap the viewport", () => {
    // Viewport 2..5 overlaps row1 and row2.
    expect(visibleWindow(wrapped, 2, 3)).toEqual({ end: 3, start: 1, top: 1 });
  });

  test("leaves out a row that ends where the viewport starts", () => {
    expect(visibleWindow(wrapped, 4, 1)).toEqual({ end: 3, start: 2, top: 4 });
  });

  test("keeps a tall row that straddles the viewport top", () => {
    const ends = cumulativeRowEnds([5, 1, 1]);
    expect(visibleWindow(ends, 3, 2)).toEqual({ end: 1, start: 0, top: 0 });
  });

  test("is empty with no rows or no viewport", () => {
    expect(visibleWindow([], 0, 10)).toEqual({ end: 0, start: 0, top: 0 });
    expect(visibleWindow(fixed, 0, 0)).toEqual({ end: 0, start: 0, top: 0 });
  });
});
