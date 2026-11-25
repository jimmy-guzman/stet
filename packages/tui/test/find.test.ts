import { describe, expect, test } from "bun:test";

import { findMatches, matchColumn } from "@/utils/find";

const lines = [
  "const findMatches = () => {",
  "  return MATCHES;",
  "}",
  "// find me",
];

describe("findMatches", () => {
  test("empty query matches nothing", () => {
    expect(findMatches(lines, "")).toEqual([]);
  });

  test("a lowercase query folds case", () => {
    expect(findMatches(lines, "matches")).toEqual([0, 1]);
  });

  test("an uppercase character makes the query case-sensitive", () => {
    expect(findMatches(lines, "MATCHES")).toEqual([1]);
  });

  test("returns every matching line index", () => {
    expect(findMatches(lines, "find")).toEqual([0, 3]);
  });

  test("a query with no hits returns no indices", () => {
    expect(findMatches(lines, "zzz")).toEqual([]);
  });
});

describe("matchColumn", () => {
  test("finds where the match starts, smart-case", () => {
    expect(matchColumn("  return MATCHES;", "matches")).toBe(9);
    expect(matchColumn("  return matches;", "MATCHES")).toBe(-1);
  });

  test("is an offset into the line itself, which lowercasing can lengthen", () => {
    expect(matchColumn(`${"\u0130".repeat(80)}needle`, "needle")).toBe(80);
    expect(matchColumn("\u0130needle", "needle")).toBe(1);
    expect(matchColumn("\u0130", "needle")).toBe(-1);
  });
});
