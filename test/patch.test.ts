import { describe, expect, test } from "bun:test";

import { lineReference } from "../src/git/patch";

describe("lineReference", () => {
  test("anchors an added line to its new line number", () => {
    expect(lineReference("src/a.ts", { content: "const b = 3", newLine: 2 })).toEqual({
      line: 2,
      path: "src/a.ts",
      snippet: "const b = 3",
    });
  });

  test("falls back to the old line number for a removed line", () => {
    expect(lineReference("src/a.ts", { content: "const b = 2", oldLine: 2 })).toEqual({
      line: 2,
      path: "src/a.ts",
      snippet: "const b = 2",
    });
  });
});
