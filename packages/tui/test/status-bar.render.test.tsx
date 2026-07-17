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

  test("lets a transient notification take over the full row", async () => {
    const repoRoot = createFixtureRepo("stet-statusbar-", { "notes.txt": "alpha\n" });
    writeFileSync(join(repoRoot, "notes.txt"), "alpha\nbravo\n");

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    const { renderer, renderOnce, captureCharFrame } = await testRender(() => <App />, {
      height: 30,
      width: 110,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      state.notify("copied src/state.ts", "success");
      const frame = await settleUntil("notification fills the status line", (current) =>
        current.includes("✓ copied src/state.ts"),
      );
      const statusLine = frame.split("\n").find((row) => row.includes("copied src/state.ts"));

      expect(statusLine).toBeDefined();
      expect(statusLine).not.toContain("? keys · q quit");
    } finally {
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
    }
  }, 20_000);

  test("lets the caret finding take over the full row", async () => {
    const repoRoot = createFixtureRepo("stet-statusbar-", { "notes.txt": "alpha\n" });
    writeFileSync(join(repoRoot, "notes.txt"), "alpha\nbravo\n");

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    state.setDiagnosticsEnabled(false);
    const { renderer, renderOnce, captureCharFrame } = await testRender(() => <App />, {
      height: 30,
      width: 110,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil("caret on the changed line", (frame) => /ln 2:1\b/.test(frame));
      state.setCheckerState({
        diagnostics: new Map([
          [
            "notes.txt",
            {
              count: 1,
              diagnostics: [
                {
                  checker: "diagnostics",
                  line: 2,
                  message: "unused value",
                  path: "notes.txt",
                  severity: "warning",
                },
              ],
              status: "findings",
            },
          ],
        ]),
      });
      const frame = await settleUntil("finding fills the status line", (current) =>
        current.includes("⚠ diagnostics: unused value"),
      );
      const statusLine = frame.split("\n").find((row) => row.includes("diagnostics: unused value"));

      expect(statusLine).toBeDefined();
      expect(statusLine).not.toContain("? keys · q quit");
    } finally {
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
    }
  }, 20_000);

  test("promotes ambient activity when it cannot fit beside the generic hint", async () => {
    const path = "src/components/StatusBar.tsx";
    const repoRoot = createFixtureRepo("stet-statusbar-", { [path]: "alpha\n" });
    writeFileSync(join(repoRoot, path), "alpha\nbravo\n");

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    const { renderer, renderOnce, captureCharFrame } = await testRender(() => <App />, {
      height: 30,
      width: 48,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      state.setActivityLog(
        recordActivity(emptyActivityLog, [{ kind: "changed", path }], Date.now()),
      );
      const frame = await settleUntil("activity fills the narrow status line", (current) =>
        current.includes("StatusBar.tsx"),
      );
      const statusLine = frame.split("\n").find((row) => row.includes("StatusBar.tsx"));

      expect(statusLine).toBeDefined();
      expect(statusLine).toContain("●");
      expect(statusLine).not.toContain("? keys · q quit");
    } finally {
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
    }
  }, 20_000);

  test("keeps active find guidance when ambient activity needs more room", async () => {
    const path = "src/components/really/deep/StatusBar.tsx";
    const repoRoot = createFixtureRepo("stet-statusbar-", { [path]: "alpha\n" });
    writeFileSync(join(repoRoot, path), "alpha\nbravo\n");

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    const { renderer, renderOnce, captureCharFrame } = await testRender(() => <App />, {
      height: 30,
      width: 80,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      state.setActivityLog(
        recordActivity(emptyActivityLog, [{ kind: "changed", path }], Date.now()),
      );
      state.setFindOpen(true);
      const frame = await settleUntil(
        "find guidance and activity share the status line",
        (current) =>
          current
            .split("\n")
            .some((row) => row.includes("type to find") && row.includes("StatusBar.tsx")),
      );
      const statusLine = frame
        .split("\n")
        .find((row) => row.includes("type to find") && row.includes("StatusBar.tsx"));

      expect(statusLine).toBeDefined();
      expect(statusLine).toContain("●");
    } finally {
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
    }
  }, 20_000);
});
