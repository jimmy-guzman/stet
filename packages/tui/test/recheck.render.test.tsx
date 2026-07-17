import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";

import { testRender } from "@opentui/solid";

import { App } from "@/App";
import { state } from "@/state";

import { createFixtureRepo, loadModel, makeSettleUntil, seedState } from "./helpers";

describe("re-running diagnostics", () => {
  test("r shows progress, then returns to guidance leaving nothing behind", async () => {
    const repoRoot = createFixtureRepo("stet-recheck-", { "README.md": "# Fixture\n" });
    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    const { renderer, renderOnce, captureCharFrame, mockInput } = await testRender(() => <App />, {
      height: 34,
      width: 120,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      const initial = await settleUntil("app chrome", (frame) => frame.includes("? help · q quit"));
      expect(initial).toContain("? help · q quit");

      mockInput.pressKey("r");

      // `runChecks` raises the run before its first await, so the progress line is the model the
      // Instant the key lands: the acknowledgment never waits on the servers it is announcing.
      expect(state.statusBarModel()).toMatchObject({
        category: "background-progress",
        level: "info",
        message: "running diagnostics…",
      });

      // A clean run says nothing. The header's counts and the file badges it just updated are the
      // Completion signal, so the row goes back to guidance rather than parking a `checks passed`
      // That would outlive its usefulness and could sit beside a red error count.
      const after = await settleUntil(
        "the bar to return to guidance",
        (frame) => frame.includes("? help · q quit") && !frame.includes("running diagnostics…"),
      );
      expect(after).not.toContain("checks passed");
    } finally {
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
    }
  }, 20_000);
});
