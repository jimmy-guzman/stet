import { describe, expect, test } from "bun:test";

import { formatCopyReference } from "@/clipboard/reference";

describe("copy reference formatting", () => {
  test("formats path-only fallback", () => {
    expect(formatCopyReference({ path: "src/a.ts" })).toBe("src/a.ts");
  });

  test("formats path and line", () => {
    expect(formatCopyReference({ line: 2, path: "src/a.ts" })).toBe(
      "src/a.ts:2"
    );
  });

  test("formats a line range", () => {
    expect(formatCopyReference({ endLine: 9, line: 2, path: "src/a.ts" })).toBe(
      "src/a.ts:2-9"
    );
  });

  test("a range of one line reads as that line", () => {
    expect(formatCopyReference({ endLine: 2, line: 2, path: "src/a.ts" })).toBe(
      "src/a.ts:2"
    );
  });

  test("drops a range with no line", () => {
    expect(formatCopyReference({ endLine: 9, path: "src/a.ts" })).toBe(
      "src/a.ts"
    );
  });
});
