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
      // Main runs the initial checks at startup; mirror that here.
      void state.runChecks(model);
      await settleUntil("initial checks finish", (frame) => frame.includes("checks finished"), 5);

      // Switching scope must re-point the changed set and re-run checks against it; the staged
      // Scope label only appears once the switch (and its recheck) have taken effect.
      mockInput.pressKey("s");
      const after = await settleUntil(
        "recheck after scope switch",
        (frame) => frame.includes("staged vs HEAD") && frame.includes("checks finished"),
      );
      expect(after).toContain("staged vs HEAD");
    } finally {
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
    }
  }, 20_000);
});
