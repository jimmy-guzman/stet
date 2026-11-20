import { expect, test } from "bun:test";

import { highlightSnippet } from "@/diff/engine";

// The test preload initializes the shared highlighter and the active theme, so a
// TS snippet tokenizes and colors without a network or LSP touch.
test("highlightSnippet colors a typescript snippet", async () => {
  const lines = await highlightSnippet("const alpha: number = 1", "typescript");
  expect(lines).toHaveLength(1);
  expect(lines[0]?.map((span) => span.text).join("")).toBe(
    "const alpha: number = 1"
  );
  // Highlighting ran: tokens carry distinct syntax colors (plain text is one color).
  expect(new Set(lines[0]?.map((span) => span.fg)).size).toBeGreaterThan(1);
});

test("highlightSnippet preserves every line of a multi-line signature", async () => {
  const lines = await highlightSnippet(
    "const a = 1\nconst b = 2",
    "typescript"
  );

  expect(lines.map((line) => line.map((span) => span.text).join(""))).toEqual([
    "const a = 1",
    "const b = 2",
  ]);
});

test("highlightSnippet falls back to one plain span per line for an unknown language", async () => {
  const lines = await highlightSnippet("some text", "not-a-real-language-xyz");
  expect(lines.map((line) => line.map((span) => span.text))).toEqual([
    ["some text"],
  ]);
});

test("highlightSnippet colors code with the active theme's syntax colors", async () => {
  // Stet-dark's own code colors (`builtins.ts`), the default with no terminal palette.
  const [line] = await highlightSnippet(
    'import { x } from "y"; // note',
    "typescript"
  );

  const colorOf = (text: string) =>
    line?.find((span) => span.text.trim() === text)?.fg?.toLowerCase();

  expect(colorOf("import")).toBe("#c79ef7");
  expect(colorOf('"y"')).toBe("#91d39f");
  expect(colorOf("// note")).toBe("#707274");
});
