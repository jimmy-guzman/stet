import { expect, test } from "bun:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { normalizeDefinition, normalizeReferences, parseHover } from "@/intel/protocol";

const uri = pathToFileURL("/repo/src/target.ts").href;
const path = fileURLToPath(uri);
const range = { end: { character: 9, line: 4 }, start: { character: 2, line: 4 } };

test("normalizeDefinition returns empty for null", () => {
  expect(normalizeDefinition(null)).toEqual([]);
});

test("normalizeDefinition maps a single Location to 1-based path:line:col", () => {
  expect(normalizeDefinition({ range, uri })).toEqual([{ column: 3, line: 5, path }]);
});

test("normalizeDefinition maps a Location array", () => {
  const other = {
    range: { end: { character: 1, line: 0 }, start: { character: 0, line: 0 } },
    uri,
  };
  expect(normalizeDefinition([{ range, uri }, other])).toEqual([
    { column: 3, line: 5, path },
    { column: 1, line: 1, path },
  ]);
});

test("normalizeDefinition prefers a LocationLink's targetSelectionRange over targetRange", () => {
  const link = {
    targetRange: { end: { character: 0, line: 10 }, start: { character: 0, line: 3 } },
    targetSelectionRange: range,
    targetUri: uri,
  };
  expect(normalizeDefinition([link])).toEqual([{ column: 3, line: 5, path }]);
});

test("normalizeDefinition falls back to a LocationLink's targetRange", () => {
  const link = { targetRange: range, targetUri: uri };
  expect(normalizeDefinition([link])).toEqual([{ column: 3, line: 5, path }]);
});

test("normalizeDefinition drops malformed items", () => {
  expect(normalizeDefinition([{ range, uri }, { nope: true }, null])).toEqual([
    { column: 3, line: 5, path },
  ]);
});

test("normalizeDefinition drops a LocationLink with a present-but-malformed targetSelectionRange", () => {
  // A non-nullish, non-range selection range must not reach the `.start` read; skip the link.
  const link = { targetRange: range, targetSelectionRange: 42, targetUri: uri };
  expect(normalizeDefinition([link, { range, uri }])).toEqual([{ column: 3, line: 5, path }]);
});

test("normalizeDefinition skips non-file URIs instead of throwing", () => {
  const untitled = { range, uri: "untitled:Untitled-1" };
  expect(normalizeDefinition([untitled, { range, uri }])).toEqual([{ column: 3, line: 5, path }]);
  expect(normalizeDefinition(untitled)).toEqual([]);
});

test("normalizeReferences maps a Location array and ignores a non-array reply", () => {
  expect(normalizeReferences([{ range, uri }])).toEqual([{ column: 3, line: 5, path }]);
  expect(normalizeReferences(null)).toEqual([]);
  expect(normalizeReferences({ range, uri })).toEqual([]);
});

test("parseHover returns an empty array for a null reply", () => {
  expect(parseHover(null)).toEqual([]);
});

test("parseHover reads a plaintext MarkupContent as prose", () => {
  expect(parseHover({ contents: { kind: "plaintext", value: "const alpha: number" } })).toEqual([
    { kind: "prose", lines: ["const alpha: number"] },
  ]);
});

test("parseHover reads a MarkedString code segment with its language", () => {
  expect(parseHover({ contents: { language: "typescript", value: "function f(): void" } })).toEqual(
    [{ kind: "code", lang: "typescript", lines: ["function f(): void"] }],
  );
});

test("parseHover splits a MarkedString array into code and prose, skipping empties", () => {
  expect(
    parseHover({ contents: [{ language: "typescript", value: "const a: 1" }, "", "Docs here."] }),
  ).toEqual([
    { kind: "code", lang: "typescript", lines: ["const a: 1"] },
    { kind: "prose", lines: ["Docs here."] },
  ]);
});

test("parseHover captures the fence language and drops the fence lines and blank runs", () => {
  const markdown = "```typescript\nconst alpha: number\n```\n\n\nA constant.";
  expect(parseHover({ contents: { kind: "markdown", value: markdown } })).toEqual([
    { kind: "code", lang: "typescript", lines: ["const alpha: number"] },
    { kind: "prose", lines: ["A constant."] },
  ]);
});

test("parseHover keeps a multi-line code block and a bare fence has no language", () => {
  const markdown = "```\nline one\nline two\n```";
  expect(parseHover({ contents: { kind: "markdown", value: markdown } })).toEqual([
    { kind: "code", lang: undefined, lines: ["line one", "line two"] },
  ]);
});
