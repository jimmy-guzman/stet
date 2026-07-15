import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { testRender } from "@opentui/solid";

import { App } from "@/App";
import { state } from "@/state";

import { createFixtureRepo, loadModel, makeSettleUntil, seedState } from "./helpers";

// The `a` key toggles a per-line provenance rail. With the session base at HEAD (seedState's
// Default), a committed line reads as the earlier band (thin `▏`) and an uncommitted
// Working-tree line as the uncommitted band (thick `▋`). The status bar shows the caret
// Line's provenance detail. Drives the real keymap so the whole path is exercised.
describe("provenance rail", () => {
  test("`a` toggles the rail: uncommitted and earlier bands, status detail, and off again", async () => {
    // Exported, so the real oxlint on PATH finds nothing to report. A finding on the caret line
    // Outranks the blame detail in the status bar by design, so an unused `const c` would contend
    // For the very slot this test asserts on.
    const repoRoot = createFixtureRepo("stet-provenance-", {
      "src/a.ts": "export const a = 1\nexport const b = 2\n",
    });
    // Append an uncommitted line so the file mixes committed context and a working-tree line.
    writeFileSync(
      join(repoRoot, "src", "a.ts"),
      "export const a = 1\nexport const b = 2\nexport const c = 3\n",
    );

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    const { renderer, renderOnce, captureCharFrame, mockInput } = await testRender(() => <App />, {
      height: 30,
      width: 110,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      state.selectFile("src/a.ts");
      await settleUntil("file open in the viewer", (frame) => frame.includes("const c = 3"));

      // No rail until it is toggled on.
      expect(captureCharFrame().includes("▋")).toBe(false);

      mockInput.pressKey("a");
      await settleUntil("rail on", () => state.blameEnabled());

      // The added working-tree line is the uncommitted band (thick), the committed context
      // The earlier band (thin); both render in the gutter.
      await settleUntil(
        "both provenance bands render",
        (frame) => frame.includes("▋") && frame.includes("▏"),
      );

      // The caret homes to the first changed line (the appended working-tree line), so the
      // Status bar's commit line reads its uncommitted detail.
      await settleUntil("status shows the uncommitted detail", (frame) =>
        frame.includes("uncommitted · working tree"),
      );

      // Focus the viewer, then move the caret up to a committed context line: the status shows
      // Its commit (author, a sane age, subject). The fixture commit is fresh, so the age is
      // `now`, guarding the seconds-vs-milliseconds age bug.
      mockInput.pressTab();
      mockInput.pressKey("k");
      await settleUntil("status shows the committed line's commit with a sane age", (frame) =>
        frame.includes("Stet Test · now · fixture"),
      );

      // Toggling off restores the gutter with no rail glyphs.
      mockInput.pressKey("a");
      await settleUntil("rail off", () => !state.blameEnabled());
      expect(captureCharFrame().includes("▋")).toBe(false);
    } finally {
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
    }
  }, 20_000);
});
