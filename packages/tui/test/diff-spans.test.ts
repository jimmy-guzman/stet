import { describe, expect, test } from "bun:test";

import { cellWidth } from "@/diff/cells";
import { columnToIndex, markRange } from "@/diff/spans";

describe("markRange", () => {
  test("splits a span so the display range carries the highlight flag", () => {
    // "const value": highlight columns [6, 11) → "value".
    const spans = [{ fg: "#f00", text: "const value" }];
    expect(markRange(spans, 6, 11)).toEqual([
      { fg: "#f00", text: "const " },
      { fg: "#f00", highlight: true, text: "value" },
    ]);
  });

  test("highlights across a span boundary, preserving each span's color", () => {
    const spans = [
      { fg: "#f00", text: "ab" },
      { fg: "#0f0", text: "cd" },
    ];

    expect(markRange(spans, 1, 3)).toEqual([
      { fg: "#f00", text: "a" },
      { fg: "#f00", highlight: true, text: "b" },
      { fg: "#0f0", highlight: true, text: "c" },
      { fg: "#0f0", text: "d" },
    ]);
  });

  test("a non-positive range leaves the spans untouched", () => {
    const spans = [{ text: "abc" }];
    expect(markRange(spans, 2, 2)).toEqual(spans);
  });
});

describe("columnToIndex", () => {
  test("maps a display column to a UTF-16 string index", () => {
    expect(columnToIndex("const x", 0)).toBe(0);
    expect(columnToIndex("const x", 6)).toBe(6);
    expect(columnToIndex("const x", 99)).toBe(7);
  });

  test("a tab is the two cells it paints", () => {
    expect(columnToIndex("\tif", 1)).toBe(0);
    expect(columnToIndex("\tif", 2)).toBe(1);
    expect(columnToIndex("a\tb", 3)).toBe(2);
  });

  test("a cluster is one glyph of the cells it paints", () => {
    expect(columnToIndex("👍🏽x", 1)).toBe(0);
    expect(columnToIndex("👍🏽x", 2)).toBe(4);
  });

  test("a column inside a wide glyph returns that glyph's start", () => {
    // "你好": each glyph is two columns wide; column 3 is inside the second glyph.
    expect(columnToIndex("你好", 0)).toBe(0);
    expect(columnToIndex("你好", 2)).toBe(1);
    expect(columnToIndex("你好", 3)).toBe(1);
  });
});

describe("cellWidth", () => {
  test.each([
    ["const x", 7],
    ["\t\tx", 5],
    ["日本", 4],
    ["👍🏽", 2],
    ["\u001B[31mred", 7],
    ["soft\u00ADhyphen", 11],
    ["काम", 3],
    ["a\u0007b", 2],
    ["", 0],
  ])("%j is %i cells, as OpenTUI paints it", (text, cells) => {
    expect(cellWidth(text)).toBe(cells);
  });
});
