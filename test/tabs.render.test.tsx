import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createMockMouse } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";

import { App } from "../src/App";
import { state } from "../src/state";
import { createFixtureRepo, loadModel, makeSettleUntil, seedState } from "./helpers";

describe("tabs strip", () => {
  test("appears with a second tab, swaps content, and collapses on close", async () => {
    const body = Array.from({ length: 20 }, (_, index) => `const line${index + 1} = ${index + 1}`);
    const repoRoot = createFixtureRepo("sideye-tabs-", {
      "package.json": `${JSON.stringify({ scripts: { lint: "exit 0", typecheck: "exit 0" } })}\n`,
      "src/a.ts": `${body.join("\n")}\n`,
      "src/b.ts": `${body.join("\n")}\n`,
    });
    writeFileSync(
      join(repoRoot, "src", "a.ts"),
      `${["const line1 = 1", "const aChanged = true", ...body.slice(2)].join("\n")}\n`,
    );
    writeFileSync(
      join(repoRoot, "src", "b.ts"),
      `${["const line1 = 1", "const bChanged = true", ...body.slice(2)].join("\n")}\n`,
    );

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    const { renderer, renderOnce, captureCharFrame, mockInput } = await testRender(() => <App />, {
      height: 30,
      width: 120,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil("diff view", (frame) => /ln \d/.test(frame), 5);

      // One preview tab: no strip, just the path on the left.
      state.selectFile("src/a.ts");
      await settleUntil(
        "a.ts preview",
        (frame) => frame.includes("src/a.ts") && frame.includes("aChanged"),
      );
      expect(state.tabItems().length).toBe(1);
      expect(state.tabItems()[0].preview).toBe(true);

      // Ctrl-t pins a.ts; navigating to b.ts then opens a fresh preview, so the
      // Strip appears with the pinned a.ts (basename) and the active preview b.ts.
      mockInput.pressKey("t", { ctrl: true });
      state.selectFile("src/b.ts");
      const twoTabs = await settleUntil("b.ts active", (frame) => frame.includes("bChanged"));
      expect(state.tabItems().length).toBe(2);
      expect(twoTabs).toContain("src/b.ts"); // Active tab shows its path
      expect(twoTabs).toContain("a.ts"); // Pinned tab shows its basename
      expect(twoTabs).not.toContain("src/a.ts"); // ...not its full path
      // Stats stay on the right, and the diff/file word is gone.
      expect(twoTabs).toMatch(/\+\d+ -\d+ · ln \d+/);
      expect(twoTabs).not.toContain("· diff");

      // Cycle to the pinned tab: the viewer swaps to a.ts.
      state.cycleTab(-1);
      const back = await settleUntil("a.ts active again", (frame) => frame.includes("aChanged"));
      expect(back).toContain("src/a.ts");
      expect(back).not.toContain("src/b.ts");

      // Closing the pinned tab leaves only the preview, so the strip disappears.
      mockInput.pressKey("w", { ctrl: true });
      const collapsed = await settleUntil(
        "back to one tab",
        (frame) => frame.includes("src/b.ts") && frame.includes("bChanged"),
      );
      expect(state.tabItems().length).toBe(1);
      expect(collapsed).toMatch(/\+\d+ -\d+ · ln \d+/);
    } finally {
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
    }
  }, 20_000);

  test("clicking a tab switches it; double-clicking starts no text selection", async () => {
    const body = Array.from({ length: 20 }, (_, index) => `const line${index + 1} = ${index + 1}`);
    const repoRoot = createFixtureRepo("sideye-tabcursor-", {
      "package.json": `${JSON.stringify({ scripts: { lint: "exit 0", typecheck: "exit 0" } })}\n`,
      "src/a.ts": `${body.join("\n")}\n`,
      "src/b.ts": `${body.join("\n")}\n`,
    });
    writeFileSync(
      join(repoRoot, "src", "a.ts"),
      `const aChanged = true\n${body.slice(1).join("\n")}\n`,
    );
    writeFileSync(
      join(repoRoot, "src", "b.ts"),
      `const bChanged = true\n${body.slice(1).join("\n")}\n`,
    );

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    const { renderer, renderOnce, captureCharFrame, mockInput } = await testRender(() => <App />, {
      height: 30,
      width: 120,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });
    const mouse = createMockMouse(renderer);

    try {
      await settleUntil("diff view", (frame) => /ln \d/.test(frame), 5);
      // Pin a.ts, then preview b.ts -> strip shows [a.ts][src/b.ts].
      state.selectFile("src/a.ts");
      mockInput.pressKey("t", { ctrl: true });
      state.selectFile("src/b.ts");
      const frame = await settleUntil("two tabs", (f) => f.includes("src/b.ts"));

      // Locate the pinned "a.ts" tab in the strip (right of the sidebar columns).
      const lines = frame.split("\n");
      const rowIndex = lines.findIndex((line) => line.includes("src/b.ts"));
      const column = lines[rowIndex].indexOf("a.ts", state.sidebarWidth());
      expect(column).toBeGreaterThan(0);

      // A single click switches to a.ts; no terminal cursor lingers.
      await mouse.click(column + 1, rowIndex);
      const onA = await settleUntil("a.ts diff", (f) => f.includes("aChanged"));
      expect(state.selectedPath()).toBe("src/a.ts");
      expect(renderer.getCursorState().visible).toBe(false);

      // A double-click on a tab must not start a text selection (the stray
      // Highlight): the tab strip is non-selectable chrome.
      await mouse.doubleClick(column + 1, rowIndex);
      await renderOnce();
      expect(renderer.getSelection()).toBeNull();

      // Control: double-clicking selectable diff content does start a selection,
      // So the assertion above is meaningful (the harness can select).
      const diffLines = onA.split("\n");
      const diffRow = diffLines.findIndex((line) => line.includes("aChanged"));
      const diffCol = diffLines[diffRow].indexOf("aChanged");
      await mouse.doubleClick(diffCol + 1, diffRow);
      await renderOnce();
      expect(renderer.getSelection()).not.toBeNull();
    } finally {
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
    }
  }, 20_000);
});
