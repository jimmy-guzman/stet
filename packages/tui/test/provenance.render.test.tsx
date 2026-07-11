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
    const repoRoot = createFixtureRepo("stet-provenance-", {
      "src/a.ts": "const a = 1\nconst b = 2\n",
    });
    // Append an uncommitted line so the file mixes committed context and a working-tree line.
    writeFileSync(join(repoRoot, "src", "a.ts"), "const a = 1\nconst b = 2\nconst c = 3\n");

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

      // Focus the viewer, then move the caret up to a committed context line: it traces to the
      // File's first commit, so the status names its tier in text (readable with color off).
      mockInput.pressTab();
      mockInput.pressKey("k");
      await settleUntil("status names the committed tier", (frame) => frame.includes("initial · "));

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
