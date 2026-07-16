import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { testRender } from "@opentui/solid";

import { App } from "@/App";
import { state } from "@/state";
import { setSelection } from "@/theme/active";

import { createFixtureRepo, loadModel, makeSettleUntil, seedState } from "./helpers";

// Under a monochrome theme the change bar's add/remove distinction cannot ride on
// Color, so the bar cell renders `+`/`-` instead of the `▎` block. The sidebar is
// Closed so a captured terminal row holds only viewer cells, keeping the +/-
// Assertions on the diff gutter rather than a tree badge that shares the row.
describe("monochrome change bar", () => {
  test("mono-dark renders +/- where the block bar rode on color", async () => {
    const repoRoot = createFixtureRepo("stet-mono-bar-", {
      "package.json": `${JSON.stringify({ scripts: { lint: "exit 0" } })}\n`,
      "src/a.ts": "const before = 1\n",
    });
    writeFileSync(join(repoRoot, "src", "a.ts"), "const AFTERWARD = 2\n");

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    state.setSidebarOpen(false);
    setSelection("mono-dark");
    const { renderer, renderOnce, captureCharFrame } = await testRender(() => <App />, {
      height: 24,
      width: 80,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      const frame = await settleUntil(
        "diff loaded",
        (current) => current.includes("AFTERWARD") && current.includes("before"),
      );

      expect(frame).not.toContain("▎");
      const removeRow = frame.split("\n").find((line) => line.includes("before"));
      const addRow = frame.split("\n").find((line) => line.includes("AFTERWARD"));
      expect(removeRow).toContain("-");
      expect(addRow).toContain("+");

      // Switching back to a colored theme restores the block bar live.
      setSelection(undefined);
      const colored = await settleUntil("block bar restored", (current) => current.includes("▎"));
      expect(colored).toContain("▎");
    } finally {
      setSelection(undefined);
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
    }
  }, 20_000);
});
