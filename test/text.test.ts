import { describe, expect, test } from "bun:test";

import { toCodePoints, truncateAroundMatch, truncateLeft } from "@/utils/text";

const rangeFrom = (start: number, length: number) =>
  Array.from({ length }, (_, offset) => start + offset);

const visibleMatch = (result: { text: string; matched: number[] }) => {
  const chars = toCodePoints(result.text);
  return result.matched.map((index) => chars[index]).join("");
};

describe("truncateAroundMatch", () => {
  test("returns the text unchanged when it already fits", () => {
    const matched = [0, 1, 2];
    const result = truncateAroundMatch("src/a.ts", matched, 20);
    expect(result.text).toBe("src/a.ts");
    expect(result.matched).toEqual(matched);
  });

  test("with no match it behaves like truncateLeft", () => {
    const text = "src/components/very/long/path/name.tsx";
    expect(truncateAroundMatch(text, [], 20).text).toBe(truncateLeft(text, 20));
  });

  test("keeps a basename match by anchoring to the tail", () => {
    const text = "src/very/deep/nested/path/to/error-patterns.md";
    const start = text.indexOf("patterns");
    const result = truncateAroundMatch(text, rangeFrom(start, "patterns".length), 24);

    expect(toCodePoints(result.text).length).toBeLessThanOrEqual(24);
    expect(result.text.startsWith("…")).toBe(true);
    expect(result.text.endsWith(".md")).toBe(true);
    expect(visibleMatch(result)).toBe("patterns");
  });

  test("shifts the window to a mid-path match, clipping both sides", () => {
    const text = "aaaaaaaaXXXXbbbbbbbb";
    const result = truncateAroundMatch(text, rangeFrom(8, 4), 10);

    expect(result.text).toBe("…XXXXbbbb…");
    expect(visibleMatch(result)).toBe("XXXX");
  });

  test("keeps the basename-side end of a match wider than the budget", () => {
    const result = truncateAroundMatch("abcdefghijklmnop", rangeFrom(2, 12), 6);

    expect(toCodePoints(result.text).length).toBeLessThanOrEqual(6);
    expect(result.text.startsWith("…")).toBe(true);
    // The last matched chars (nearest the basename) stay visible, not the head.
    expect(visibleMatch(result).endsWith("n")).toBe(true);
  });

  test("keeps the later run of a two-term match visible when both cannot fit", () => {
    // "…aaa/references/error-patterns" style: a leading-dir run and a basename
    // Run too far apart to both fit; the basename-side run must survive.
    const text = "leaddir/aaaaaaaaaaaaaaaaaaaaaa/error-patterns.md";
    const leadRun = rangeFrom(0, 4); // "lead"
    const tailStart = text.indexOf("patterns");
    const tailRun = rangeFrom(tailStart, "patterns".length);
    const result = truncateAroundMatch(text, [...leadRun, ...tailRun], 24);

    expect(toCodePoints(result.text).length).toBeLessThanOrEqual(24);
    expect(result.text).toContain("patterns");
    expect(visibleMatch(result)).toContain("patterns");
  });
});
