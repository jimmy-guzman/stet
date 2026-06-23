import { describe, expect, test } from "bun:test";

import { sliceSpansWindow } from "../src/diff/spans";

describe("sliceSpansWindow", () => {
  test("keeps spans that fit within the budget from column 0", () => {
    const spans = [{ fg: "#f00", text: "const" }, { text: " x" }];
    expect(sliceSpansWindow(spans, 0, 20)).toEqual(spans);
  });

  test("clips to the width, left-aligned, from column 0", () => {
    const spans = [
      { fg: "#f00", text: "const" },
      { fg: "#0f0", text: " value = 1" },
    ];
    expect(sliceSpansWindow(spans, 0, 8)).toEqual([
      { fg: "#f00", text: "const" },
      { fg: "#0f0", text: " va" },
    ]);
  });

  test("scrolls horizontally: skips `start` columns, then takes `width`", () => {
    const spans = [
      { fg: "#f00", text: "const" },
      { fg: "#0f0", text: " value = 1" },
    ];
    // Skip 6 cols ("const "), then take 5 → "value".
    expect(sliceSpansWindow(spans, 6, 5)).toEqual([{ fg: "#0f0", text: "value" }]);
  });

  test("drops spans entirely before or after the window", () => {
    const spans = [{ text: "abcd" }, { fg: "#0f0", text: "EFGH" }, { text: "ijkl" }];
    expect(sliceSpansWindow(spans, 4, 4)).toEqual([{ fg: "#0f0", text: "EFGH" }]);
  });

  test("counts wide CJK glyphs as two columns", () => {
    expect(sliceSpansWindow([{ text: "你好世" }], 0, 5)).toEqual([{ text: "你好" }]);
  });

  test("returns nothing for a non-positive width", () => {
    expect(sliceSpansWindow([{ text: "x" }], 0, 0)).toEqual([]);
  });
});
