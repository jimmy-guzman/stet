import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { testRender } from "@opentui/solid";

import { App } from "@/App";
import { state } from "@/state";

import { createFixtureRepo, loadModel, makeSettleUntil, seedState } from "./helpers";

// The double-click guard reads only the clicks its pane forwards to it, so a click on a
// Row the pane otherwise ignores (a directory in the tree, a file header in search) must
// Still reach the guard, or a slow-but-in-window sequence of three separate single clicks
// (target -> other row -> same target) reads as a double and fires the navigating action.
describe("double-click tracker resets on an intervening row click", () => {
  // The left (sidebar) and right (viewer/search) panes share a `││` seam, and the same file
  // Name appears in both, so scope the frame scan to one pane before locating a row.
  const paneRowOf = (frame: string, side: "left" | "right", text: string) =>
    frame
      .split("\n")
      .map((line) => {
        const parts = line.split("││");
        return side === "left" ? (parts[0] ?? "") : parts.slice(1).join("││");
      })
      .findIndex((cell) => cell.includes(text));

  test("a directory click between two clicks on the same file does not pin it as a tab", async () => {
    const repoRoot = createFixtureRepo("stet-tree-dblclick-", {
      "a.txt": "alpha\n",
      "pkg/inner.ts": "export const inner = 1;\n",
    });
    const scope = { kind: "all", ref: "HEAD" } as const;
    const model = await loadModel(repoRoot, scope);
    seedState(model, scope);

    const { renderer, mockMouse, renderOnce, captureCharFrame } = await testRender(() => <App />, {
      height: 24,
      width: 100,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil(
        "tree rendered",
        (frame) => frame.includes("a.txt") && frame.includes("pkg"),
      );

      // Directories sort above files, so `pkg` is above `a.txt`; expanding it pushes
      // `a.txt` down, so the file row is re-located before the second click on it.
      const fileY = paneRowOf(captureCharFrame(), "left", "a.txt");
      const dirY = paneRowOf(captureCharFrame(), "left", "pkg");
      expect(fileY).toBeGreaterThanOrEqual(0);
      expect(dirY).toBeGreaterThanOrEqual(0);
      expect(dirY).not.toBe(fileY);

      // File -> directory -> same file, back to back so the two file clicks land inside
      // The double-click window. The directory click must break the sequence.
      await mockMouse.click(5, fileY);
      await mockMouse.click(5, dirY);
      await renderOnce();
      const fileYAgain = paneRowOf(captureCharFrame(), "left", "a.txt");
      await mockMouse.click(5, fileYAgain);
      await renderOnce();

      // Still a single preview tab, never pinned (a false double-click would pin it).
      expect(state.selectedPath()).toBe("a.txt");
      expect(state.tabItems()).toHaveLength(1);
      expect(state.tabItems()[0]?.preview).toBe(true);
    } finally {
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test("a file-header click between two clicks on the same match does not open it", async () => {
    const repoRoot = createFixtureRepo("stet-search-dblclick-", {
      "src/a.ts": "const seed = 0\n",
      "src/b.ts": "const seed = 0\n",
    });
    writeFileSync(join(repoRoot, "src", "a.ts"), "const needleA = 1\n");
    writeFileSync(join(repoRoot, "src", "b.ts"), "const needleB = 2\n");

    const scope = { kind: "all", ref: "HEAD" } as const;
    const model = await loadModel(repoRoot, scope);
    seedState(model, scope);

    const { renderer, mockInput, mockMouse, renderOnce, captureCharFrame } = await testRender(
      () => <App />,
      { height: 30, width: 120 },
    );
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil("app chrome", (frame) => frame.includes("q quit"), 5);
      mockInput.pressKey("f", { ctrl: true });
      await settleUntil("search pane", (frame) => frame.includes("search…"));
      await mockInput.typeText("needle");
      // Two files match, so the results carry two headers with a match under each.
      await settleUntil("results", (frame) => frame.includes("2 matches in 2 files"));

      // `src/b.ts`'s group is below `src/a.ts`'s, so collapsing it never shifts the
      // Match-a row above it. Both names also appear in the sidebar, hence the scope.
      const matchY = paneRowOf(captureCharFrame(), "right", "needleA");
      const headerBY = paneRowOf(captureCharFrame(), "right", "src/b.ts");
      expect(matchY).toBeGreaterThanOrEqual(0);
      expect(headerBY).toBeGreaterThanOrEqual(0);
      expect(headerBY).not.toBe(matchY);

      // Match-a -> header-b -> same match, back to back. The header click must break the
      // Sequence, or the second match click opens the file (leaving the search view).
      await mockMouse.click(state.sidebarWidth() + 5, matchY);
      await mockMouse.click(state.sidebarWidth() + 5, headerBY);
      await mockMouse.click(state.sidebarWidth() + 5, matchY);
      await renderOnce();

      expect(state.mainView()).toBe("search");
    } finally {
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
    }
  }, 20_000);
});
