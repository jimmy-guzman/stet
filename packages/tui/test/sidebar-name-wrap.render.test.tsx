import { describe, expect, test } from "bun:test";

import { testRender } from "@opentui/solid";

import { App } from "@/App";
import { emptyActivityLog, recordActivity } from "@/git/activity";
import { state } from "@/state";

import { createFixtureRepo, loadModel, makeSettleUntil, seedState } from "./helpers";

// Guards the AGENTS.md invariant that a windowed tree row's name is pinned to one line, so a
// Wheel over it cannot scroll a wrapped name into a mid or tail fragment (the mechanism is there).
describe("sidebar filename does not scroll on wheel", () => {
  test("keeps the tree row showing the name start after a wheel over it", async () => {
    const longName = "a-really-quite-long-repository-file-name.txt";
    const repoRoot = createFixtureRepo("stet-name-wrap-", {
      [longName]: "one\n",
      "short.txt": "two\n",
    });
    const scope = { kind: "all", ref: "HEAD" } as const;
    const model = await loadModel(repoRoot, scope);
    seedState(model, scope);

    const { renderer, mockMouse, renderOnce, captureCharFrame } = await testRender(() => <App />, {
      height: 20,
      width: 100,
    });

    try {
      const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

      // Recent (a dot renders beside the name) but not a working-tree change, so no diff or
      // Diagnostic badge reserves the two cells the dot overruns the name's slot by.
      state.setActivityLog(
        recordActivity(emptyActivityLog, [{ kind: "changed", path: longName }], Date.now()),
      );

      // The header and status bar also print the name, so assert on the tree-row line alone.
      const sidebarLines = (frame: string) => frame.split("\n").map((line) => line.split("││")[0]);
      const namePrefix = longName.slice(0, 16);

      const before = sidebarLines(
        await settleUntil("name renders in the tree", (frame) =>
          sidebarLines(frame).some((line) => line.includes(namePrefix)),
        ),
      );
      const rowY = before.findIndex((line) => line.includes(namePrefix));
      expect(rowY).toBeGreaterThanOrEqual(0);
      expect(before[rowY]).toContain(namePrefix);

      const wheelDownOverName = async () => {
        await mockMouse.scroll(10, rowY, "down");
        await renderOnce();
      };
      await wheelDownOverName();
      await wheelDownOverName();
      await wheelDownOverName();

      expect(sidebarLines(captureCharFrame())[rowY]).toContain(namePrefix);
    } finally {
      renderer.destroy();
    }
  }, 20_000);
});
