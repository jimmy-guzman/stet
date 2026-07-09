import { expect, test } from "bun:test";

import { highlightSnippet } from "@/diff/engine";

// The test preload warms the shared highlighter (typescript grammar + active
// Theme), so a TS snippet tokenizes and colors without a network or LSP touch.
test("highlightSnippet colors a typescript snippet", async () => {
  const lines = await highlightSnippet("const alpha: number = 1", "typescript");
  expect(lines).toHaveLength(1);
  expect(lines[0]?.map((span) => span.text).join("")).toBe("const alpha: number = 1");
  // Highlighting ran: at least one token carries a theme color (the plain fallback carries none).
  expect(lines[0]?.some((span) => span.fg !== undefined)).toBe(true);
});

test("highlightSnippet preserves every line of a multi-line signature", async () => {
  const lines = await highlightSnippet("const a = 1\nconst b = 2", "typescript");
  expect(lines.map((line) => line.map((span) => span.text).join(""))).toEqual([
    "const a = 1",
    "const b = 2",
  ]);
});

test("highlightSnippet falls back to one plain span per line for an unknown language", async () => {
  const lines = await highlightSnippet("some text", "not-a-real-language-xyz");
  expect(lines).toEqual([[{ text: "some text" }]]);
});
