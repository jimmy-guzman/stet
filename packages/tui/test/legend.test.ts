import { describe, expect, test } from "bun:test";

import { provenanceGlyph } from "@/components/provenance";
import { legendGroups } from "@/help/legend";
import { levelGlyph } from "@/log/levels";
import { CHECK_BADGES, kindLetter } from "@/ui-helpers";

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

  test("covers the diagnostic severities and the check badges from their live sources", () => {
    const diagnostics = glyphs("diagnostics");
    expect(diagnostics).toContain(levelGlyph("error"));
    expect(diagnostics).toContain(levelGlyph("warning"));
    expect(diagnostics).toContain(levelGlyph("info"));
    expect(diagnostics).toContain(CHECK_BADGES.pending.glyph);
    expect(diagnostics).toContain(CHECK_BADGES.failed.glyph);
    expect(diagnostics).toContain(CHECK_BADGES.clean.glyph);
    expect(diagnostics).toContain(CHECK_BADGES.unavailable.glyph);
  });

  test("draws every provenance tier with the rail's own glyph", () => {
    const rail = glyphs("provenance rail (a)");
    for (const band of ["uncommitted", "session", "branch", "changed", "initial"] as const) {
      expect(rail).toContain(provenanceGlyph(band));
    }
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
