import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { testRender } from "@opentui/solid";

import { App } from "../src/App";
import { state } from "../src/state";
import { createFixtureRepo, loadModel, makeSettleUntil, seedState } from "./helpers";

describe("scope switching", () => {
  test("re-runs checks for the new scope's changed set", async () => {
    const repoRoot = createFixtureRepo("sideye-scope-", {
      "package.json": `${JSON.stringify({ name: "scope-fixture" })}\n`,
      "src/a.ts": "const a = 1\n",
    });
    // An unstaged edit: the default `all` scope sees it, the `staged` scope does not.
    writeFileSync(join(repoRoot, "src", "a.ts"), "const a = 2\n");

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    const { renderer, renderOnce, captureCharFrame, mockInput } = await testRender(() => <App />, {
      height: 34,
      width: 120,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      // Main runs the initial checks at startup; mirror that here. The `all` scope sees the unstaged
      // Edit, so a.ts shows a "+1 -1" change indicator.
      void state.runChecks(model);
      await settleUntil(
        "all scope shows the unstaged change",
        (frame) => frame.includes("+1 -1") && frame.includes("checks finished"),
        5,
      );

      // Switch to staged: nothing is staged, so the new changed set is empty and the recheck runs
      // Against it. The change indicator must disappear, which a stale all-scope frame cannot satisfy.
      mockInput.pressKey("s");
      const after = await settleUntil(
        "staged scope drops the unstaged change",
        (frame) => frame.includes("staged vs HEAD") && !frame.includes("+1 -1"),
      );
      expect(after).toContain("staged vs HEAD");
      expect(after).not.toContain("+1 -1");
    } finally {
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
    }
  }, 20_000);
});
