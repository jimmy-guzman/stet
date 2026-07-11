import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { testRender } from "@opentui/solid";

import { App } from "@/App";
import { emptyActivityLog, recordActivity } from "@/git/activity";
import { state } from "@/state";

import { createFixtureRepo, loadModel, makeSettleUntil, seedState } from "./helpers";

// The status bar shows the most recent changed file the way the tree does: the path in
// Its git change-kind color (a warm amber for modified) plus a fading recency dot, so it
// Reads as a changed file, not a neutral path. Colors can't be read from a char frame, so
// This asserts the rendered cell colors via captureSpans against a genuinely modified file.
describe("status bar changed-file cue", () => {
  test("tints the recent path by change kind and draws a recency dot", async () => {
    const repoRoot = createFixtureRepo("stet-statusbar-", { "notes.txt": "alpha\n" });
    // Modify the committed file so git reports it as `modified`.
    writeFileSync(join(repoRoot, "notes.txt"), "alpha\nbravo\n");

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    const { renderer, renderOnce, captureCharFrame, captureSpans } = await testRender(
      () => <App />,
      { height: 30, width: 110 },
    );
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      state.setActivityLog(
        recordActivity(emptyActivityLog, [{ kind: "changed", path: "notes.txt" }], Date.now()),
      );
      await settleUntil("recent file on the status line", (frame) =>
        frame.split("\n").some((row) => row.includes("q quit") && row.includes("notes.txt")),
      );

      const statusLine = captureSpans().lines.find((line) =>
        line.spans.some((span) => span.text.includes("q quit")),
      );
      const pathSpan = statusLine?.spans.find((span) => span.text.includes("notes.txt"));
      const dot = statusLine?.spans.some((span) => span.text.includes("●"));

      // The path is a warm change-kind color (modified amber: high red, low blue), not a
      // Neutral gray (where r, g, b are near-equal). This is the "changed file" cue.
      expect(pathSpan).toBeDefined();
      expect(pathSpan!.fg.r - pathSpan!.fg.b).toBeGreaterThan(0.4);
      // The recency dot renders alongside it (NO_COLOR-safe shape).
      expect(dot).toBe(true);
    } finally {
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
    }
  }, 20_000);
});
