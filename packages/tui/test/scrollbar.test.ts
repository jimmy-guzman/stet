import { describe, expect, test } from "bun:test";

import { scrollbarThumb } from "@/components/scrollbar";

describe("scrollbarThumb", () => {
  test("is hidden when the content fits the viewport", () => {
    expect(scrollbarThumb(5, 10, 0)).toBeUndefined();
    // Exact fit: still nothing to indicate.
    expect(scrollbarThumb(10, 10, 0)).toBeUndefined();
  });

  test("is hidden for a non-positive viewport", () => {
    expect(scrollbarThumb(100, 0, 0)).toBeUndefined();
  });

  test("sits flush at the top at scrollTop 0", () => {
    // Viewport 10 over 100 rows: thumb is 1/10 the height, pinned to the top.
    expect(scrollbarThumb(100, 10, 0)).toEqual({ size: 1, top: 0 });
  });

  test("sits flush at the bottom at the max scroll", () => {
    // At the max scroll (90), the thumb's last valid top is viewport - size = 9.
    expect(scrollbarThumb(100, 10, 90)).toEqual({ size: 1, top: 9 });
  });

  test("places the thumb proportionally mid-scroll", () => {
    // Half-scrolled (45 of 90): thumb centered within [0, 9].
    const thumb = scrollbarThumb(100, 10, 45);
    expect(thumb).toEqual({ size: 1, top: 5 });
  });

  test("keeps a one-cell thumb on a huge list and clamps its travel", () => {
    expect(scrollbarThumb(10_000, 10, 0)).toEqual({ size: 1, top: 0 });
    const bottom = scrollbarThumb(10_000, 10, 9990);
    expect(bottom).toEqual({ size: 1, top: 9 });
  });

  test("sizes the thumb to the visible fraction", () => {
    // Viewport 10 over 20 rows: half the content is visible, so a 5-cell thumb.
    expect(scrollbarThumb(20, 10, 0)).toEqual({ size: 5, top: 0 });
    expect(scrollbarThumb(20, 10, 10)).toEqual({ size: 5, top: 5 });
  });

  test("clamps an out-of-range scrollTop to the bottom", () => {
    const thumb = scrollbarThumb(100, 10, 1000);
    expect(thumb).toEqual({ size: 1, top: 9 });
  });

  test("never moves the thumb up as scrollTop grows", () => {
    const tops = Array.from(
      { length: 91 },
      (_, scrollTop) => scrollbarThumb(100, 10, scrollTop)?.top,
    );
    expect(tops.every((top) => top !== undefined)).toBe(true);
    tops.forEach((top, index) => {
      if (index > 0) {
        expect(top ?? 0).toBeGreaterThanOrEqual(tops[index - 1] ?? 0);
      }
    });
  });
});
