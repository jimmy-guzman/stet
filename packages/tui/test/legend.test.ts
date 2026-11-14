import { describe, expect, test } from "bun:test";

import { legendGroups } from "@/help/legend";
import { kindLetter } from "@/ui-helpers";

describe("legendGroups", () => {
  const groups = legendGroups();
  const group = (heading: string) => groups.find((entry) => entry.heading === heading);
  const glyphs = (heading: string) => group(heading)?.entries.map((entry) => entry.glyph) ?? [];

  test("draws every change kind with the tree's own letter", () => {
    const changes = glyphs("changes");
    for (const kind of ["modified", "added", "deleted", "renamed", "untracked"] as const) {
      expect(changes).toContain(kindLetter(kind));
    }
  });

  test("names every stage", () => {
    expect(
      group("stage (colors the change letter)")?.entries.map((entry) => entry.meaning),
    ).toEqual(["staged", "unstaged", "staged and unstaged", "untracked"]);
  });

  test("every row has a glyph and a meaning", () => {
    for (const legendGroup of groups) {
      for (const entry of legendGroup.entries) {
        expect(entry.glyph.length).toBeGreaterThan(0);
        expect(entry.meaning.length).toBeGreaterThan(0);
      }
    }
  });
});
