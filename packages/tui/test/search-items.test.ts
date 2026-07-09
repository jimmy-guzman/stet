import { describe, expect, test } from "bun:test";

import { buildSearchItems, isNavigableSearchItem } from "@/viewer/search-items";
import type { SearchItem } from "@/viewer/search-items";

const match = (path: string, line: number, text: string, column = 1) => ({
  column,
  line,
  path,
  text,
});

const lines = (count: number) => Array.from({ length: count }, (_, i) => `line ${i + 1}`);

const shape = (items: SearchItem[]) =>
  items.map((item) =>
    item.kind === "header"
      ? `header ${item.path} (${item.count})`
      : item.kind === "gap"
        ? "gap"
        : `${item.match === undefined ? "context" : "match"} ${item.line}`,
  );

describe("buildSearchItems", () => {
  test("groups matches by file with a header and context around each match", () => {
    const items = buildSearchItems({
      collapsed: new Set(),
      context: 2,
      linesByPath: new Map([["a.ts", lines(20)]]),
      matches: [match("a.ts", 10, "line 10")],
    });
    expect(shape(items)).toEqual([
      "header a.ts (1)",
      "context 8",
      "context 9",
      "match 10",
      "context 11",
      "context 12",
    ]);
  });

  test("merges matches whose context ranges touch or overlap into one excerpt", () => {
    const items = buildSearchItems({
      collapsed: new Set(),
      context: 2,
      linesByPath: new Map([["a.ts", lines(20)]]),
      matches: [match("a.ts", 5, "line 5"), match("a.ts", 8, "line 8")],
    });
    expect(shape(items)).toEqual([
      "header a.ts (2)",
      "context 3",
      "context 4",
      "match 5",
      "context 6",
      "context 7",
      "match 8",
      "context 9",
      "context 10",
    ]);
  });

  test("separates non-contiguous excerpts of one file with a gap", () => {
    const items = buildSearchItems({
      collapsed: new Set(),
      context: 1,
      linesByPath: new Map([["a.ts", lines(20)]]),
      matches: [match("a.ts", 2, "line 2"), match("a.ts", 10, "line 10")],
    });
    expect(shape(items)).toEqual([
      "header a.ts (2)",
      "context 1",
      "match 2",
      "context 3",
      "gap",
      "context 9",
      "match 10",
      "context 11",
    ]);
  });

  test("clamps context at the file edges", () => {
    const items = buildSearchItems({
      collapsed: new Set(),
      context: 2,
      linesByPath: new Map([["a.ts", lines(3)]]),
      matches: [match("a.ts", 1, "line 1"), match("a.ts", 3, "line 3")],
    });
    expect(shape(items)).toEqual(["header a.ts (2)", "match 1", "context 2", "match 3"]);
  });

  test("a path without file lines degrades to match-only rows from the grep text", () => {
    const items = buildSearchItems({
      collapsed: new Set(),
      context: 2,
      linesByPath: new Map(),
      matches: [match("bin.dat", 4, "grep text"), match("bin.dat", 9, "more grep text")],
    });
    expect(shape(items)).toEqual(["header bin.dat (2)", "match 4", "gap", "match 9"]);
    const rows = items.filter((item) => item.kind === "line");
    expect(rows.map((row) => row.text)).toEqual(["grep text", "more grep text"]);
  });

  test("a collapsed path contributes only its header, count intact", () => {
    const items = buildSearchItems({
      collapsed: new Set(["a.ts"]),
      context: 2,
      linesByPath: new Map([
        ["a.ts", lines(20)],
        ["b.ts", lines(20)],
      ]),
      matches: [
        match("a.ts", 5, "line 5"),
        match("a.ts", 12, "line 12"),
        match("b.ts", 3, "line 3"),
      ],
    });
    expect(shape(items)).toEqual([
      "header a.ts (2)",
      "header b.ts (1)",
      "context 1",
      "context 2",
      "match 3",
      "context 4",
      "context 5",
    ]);
    const header = items[0];
    expect(header.kind === "header" && header.collapsed).toBe(true);
  });

  test("match rows carry the flat match index and column for the jump", () => {
    const items = buildSearchItems({
      collapsed: new Set(),
      context: 0,
      linesByPath: new Map([
        ["a.ts", lines(5)],
        ["b.ts", lines(5)],
      ]),
      matches: [match("a.ts", 1, "line 1", 7), match("b.ts", 2, "line 2", 3)],
    });
    const rows = items.filter((item) => item.kind === "line");
    expect(rows.map((row) => row.match)).toEqual([
      { column: 7, index: 0 },
      { column: 3, index: 1 },
    ]);
  });

  test("line rows share a per-file gutter width sized to the widest shown line number", () => {
    const items = buildSearchItems({
      collapsed: new Set(),
      context: 1,
      linesByPath: new Map([["a.ts", lines(150)]]),
      matches: [match("a.ts", 2, "line 2"), match("a.ts", 99, "line 99")],
    });
    const rows = items.filter((item) => item.kind === "line");
    expect(new Set(rows.map((row) => row.lineWidth))).toEqual(new Set([3]));
  });

  test("context text comes from the file lines, so it matches what a jump reveals", () => {
    const items = buildSearchItems({
      collapsed: new Set(),
      context: 1,
      linesByPath: new Map([["a.ts", ["alpha", "bravo", "charlie"]]]),
      matches: [match("a.ts", 2, "bravo")],
    });
    const rows = items.filter((item) => item.kind === "line");
    expect(rows.map((row) => row.text)).toEqual(["alpha", "bravo", "charlie"]);
  });
});

describe("isNavigableSearchItem", () => {
  test("headers and match lines are navigable; context and gaps are not", () => {
    const items = buildSearchItems({
      collapsed: new Set(),
      context: 1,
      linesByPath: new Map([["a.ts", lines(20)]]),
      matches: [match("a.ts", 2, "line 2"), match("a.ts", 10, "line 10")],
    });
    expect(items.filter(isNavigableSearchItem).map((item) => item.id)).toEqual([
      "search-header-a.ts",
      "search-line-a.ts-2",
      "search-line-a.ts-10",
    ]);
  });
});
