import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { testRender } from "@opentui/solid";

import { App } from "@/app";
import { state } from "@/state";

import {
  createFixtureRepo,
  loadModel,
  makeSettleUntil,
  seedState,
} from "./helpers";

// File names also appear in the tree, so look to the right of the pane divider.
const searchRowOf = (frame: string, text: string) =>
  frame
    .split("\n")
    .findIndex((line) => line.split("│").slice(1).join("│").includes(text));

describe("search double-click", () => {
  test("a file-header click between two clicks on the same match does not open it", async () => {
    const repoRoot = createFixtureRepo("stet-search-dblclick-", {
      "src/a.ts": "const seed = 0\n",
      "src/b.ts": "const seed = 0\n",
    });

    writeFileSync(path.join(repoRoot, "src", "a.ts"), "const needleA = 1\n");
    writeFileSync(path.join(repoRoot, "src", "b.ts"), "const needleB = 2\n");

    const scope = { kind: "all", ref: "HEAD" } as const;
    const model = await loadModel(repoRoot, scope);
    seedState(model, scope);

    const { renderer, mockInput, mockMouse, renderOnce, captureCharFrame } =
      await testRender(() => <App />, { height: 30, width: 120 });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil("app chrome", (frame) => frame.includes("q quit"), 5);
      mockInput.pressKey("f", { ctrl: true });
      await settleUntil("search pane", (frame) => frame.includes("search…"));
      await mockInput.typeText("needle");
      // Two files match, so the results carry two headers with a match under each.
      await settleUntil("results", (frame) =>
        frame.includes("2 matches in 2 files")
      );

      // `src/b.ts`'s group is below `src/a.ts`'s, so collapsing it never shifts the
      // Match-a row above it. Both names also appear in the sidebar, hence the scope.
      const matchY = searchRowOf(captureCharFrame(), "needleA");
      const headerBY = searchRowOf(captureCharFrame(), "src/b.ts");
      expect(matchY).toBeGreaterThanOrEqual(0);
      expect(headerBY).toBeGreaterThanOrEqual(0);
      expect(headerBY).not.toBe(matchY);

      // Match-a -> header-b -> same match, back to back. The header click must break the
      // Sequence, or the second match click opens the file (leaving the search view).
      await mockMouse.click(state.layout().viewer.x + 5, matchY);
      await mockMouse.click(state.layout().viewer.x + 5, headerBY);
      await mockMouse.click(state.layout().viewer.x + 5, matchY);
      await renderOnce();

      expect(state.mainView()).toBe("search");
    } finally {
      renderer.destroy();
    }
  }, 20_000);
});
