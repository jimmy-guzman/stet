import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { MouseButton } from "@opentui/core";
import { testRender } from "@opentui/solid";

import { App } from "@/app";
import { state } from "@/state";

import {
  createFixtureRepo,
  loadModel,
  makeSettleUntil,
  seedState,
} from "./helpers";

// The screen row of a tree entry, read from the frame (left of the pane divider) so a
// Change to the chrome above the tree never retargets a click onto a neighboring row.
const treeRowOf = (frame: string, name: string) =>
  frame
    .split("\n")
    .findIndex((line) => (line.split("│")[0] ?? "").includes(name));

describe("context command menu", () => {
  // The menu writes the shared `state` singleton; leaving it open would swallow the
  // Keyboard in later render tests that share that global. Reset what these open.
  afterEach(() => {
    state.closeCommandMenu();
    state.setCaretLineLevel(false);
    state.setFocusedPane("tree");
  });

  test("a right-click on a tree row opens the menu with its actions, a caret, and the hint", async () => {
    const repoRoot = createFixtureRepo("stet-cmd-tree-", {
      "a.txt": "alpha\n",
      "b.txt": "beta\n",
    });

    const scope = { kind: "all", ref: "HEAD" } as const;
    const model = await loadModel(repoRoot, scope);
    seedState(model, scope);

    const { renderer, renderOnce, captureCharFrame, mockMouse } =
      await testRender(() => <App />, {
        height: 24,
        width: 100,
      });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      const tree = await settleUntil("tree shows the files", (frame) =>
        frame.includes("a.txt")
      );

      await mockMouse.click(5, treeRowOf(tree, "a.txt"), MouseButton.RIGHT);

      const frame = await settleUntil(
        "menu opens with its actions",
        (current) => current.includes("Copy path")
      );

      expect(state.commandMenuOpen()).toBe(true);
      expect(state.commandMenuContext()).toBe("tree");

      // Every file action, the selection caret, and the shared footer hint render.
      for (const label of ["Copy path", "Open in editor", "Open in IDE"]) {
        expect(frame).toContain(label);
      }

      expect(frame).toContain("▸");
      expect(frame).toContain("↑↓ navigate");
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("the viewer menu opens at a line-level caret", async () => {
    const repoRoot = createFixtureRepo("stet-cmd-viewer-", {
      "package.json": `${JSON.stringify({ name: "cmd-fixture" })}\n`,
      "src/a.ts": "const alpha = 1\n",
    });

    writeFileSync(
      path.join(repoRoot, "src", "a.ts"),
      "const alpha = 1\nconst added = 2\n"
    );

    const scope = { kind: "all", ref: "HEAD" } as const;
    const model = await loadModel(repoRoot, scope);
    seedState(model, scope);

    const { renderer, renderOnce, captureCharFrame, mockInput } =
      await testRender(() => <App />, {
        height: 28,
        width: 110,
      });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil(
        "caret on the added line",
        () => state.cursorLineNumber() === 2 && state.caretColumn() === 1
      );
      mockInput.pressTab();
      // A line-level caret, as a gutter click leaves.
      state.setCaretLineLevel(true);
      state.openCommandMenu("viewer");

      const frame = await settleUntil("viewer menu open", (current) =>
        current.includes("Copy reference")
      );

      expect(frame).toContain("Copy reference");
      // The fixture file is small, so it is not truncated: no "Show full content".
      expect(frame).not.toContain("Show full content");
      expect(frame).toContain("↑↓ navigate");
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("clicking away closes the menu so the keyboard is no longer trapped", async () => {
    const repoRoot = createFixtureRepo("stet-cmd-dismiss-", {
      "a.txt": "alpha\n",
      "b.txt": "beta\n",
    });

    const scope = { kind: "all", ref: "HEAD" } as const;
    const model = await loadModel(repoRoot, scope);
    seedState(model, scope);

    const { renderer, renderOnce, captureCharFrame, mockMouse, mockInput } =
      await testRender(() => <App />, { height: 24, width: 100 });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      const tree = await settleUntil("tree shows the files", (frame) =>
        frame.includes("b.txt")
      );

      // Open the menu on the second row (its menu box sits below, leaving the first
      // Row clickable).
      await mockMouse.click(5, treeRowOf(tree, "b.txt"), MouseButton.RIGHT);
      await settleUntil("menu open", (frame) => frame.includes("Copy path"));
      expect(state.commandMenuOpen()).toBe(true);

      // Click a different tree row: the focused node drifts, so the menu must close
      // Rather than linger invisibly and keep swallowing keys.
      await mockMouse.click(5, treeRowOf(tree, "a.txt"));

      const dismissed = await settleUntil(
        "menu closed",
        (frame) => !frame.includes("Copy path")
      );

      expect(state.commandMenuOpen()).toBe(false);
      expect(dismissed).not.toContain("↑↓ navigate");

      // The keyboard is free again: ctrl-b toggles the sidebar (it would be swallowed
      // While the menu was stuck open). Toggle back so the shared state does not leak.
      const before = state.sidebarOpen();
      mockInput.pressKey("b", { ctrl: true });
      await renderOnce();
      expect(state.sidebarOpen()).toBe(!before);
      mockInput.pressKey("b", { ctrl: true });
      await renderOnce();
      expect(state.sidebarOpen()).toBe(before);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("the tree menu closes when the sidebar scrolls its anchor row away", async () => {
    const files: Record<string, string> = {};

    for (let i = 0; i < 30; i += 1) {
      files[`f${String(i).padStart(2, "0")}.txt`] = `content ${i}\n`;
    }

    const repoRoot = createFixtureRepo("stet-cmd-scroll-", files);
    const scope = { kind: "all", ref: "HEAD" } as const;
    const model = await loadModel(repoRoot, scope);
    seedState(model, scope);

    const { renderer, renderOnce, captureCharFrame, mockMouse } =
      await testRender(() => <App />, {
        height: 24,
        width: 100,
      });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      const tree = await settleUntil("tree shows the files", (frame) =>
        frame.includes("f01.txt")
      );

      await mockMouse.click(5, treeRowOf(tree, "f01.txt"), MouseButton.RIGHT);
      await settleUntil("menu open", (frame) => frame.includes("Copy path"));
      expect(state.commandMenuOpen()).toBe(true);

      // Scrolling the sidebar moves the anchored row while the focused node stays the
      // Same, so the menu (pinned at a now-stale screen cell) must dismiss.
      state.setSidebarScrollTop(3);
      await settleUntil("menu closed", (frame) => !frame.includes("Copy path"));
      expect(state.commandMenuOpen()).toBe(false);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("the viewer menu closes when the caret moves off the symbol it opened on", async () => {
    const repoRoot = createFixtureRepo("stet-cmd-drift-", {
      "package.json": `${JSON.stringify({ name: "cmd-drift" })}\n`,
      "src/a.ts": "const alpha = 1\n",
    });

    writeFileSync(
      path.join(repoRoot, "src", "a.ts"),
      "const alpha = 1\nconst added = 2\n"
    );

    const scope = { kind: "all", ref: "HEAD" } as const;
    const model = await loadModel(repoRoot, scope);
    seedState(model, scope);

    const { renderer, renderOnce, captureCharFrame, mockInput } =
      await testRender(() => <App />, {
        height: 28,
        width: 110,
      });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil(
        "caret on the added line",
        () => state.cursorLineNumber() === 2 && state.caretColumn() === 1
      );
      mockInput.pressTab();
      state.openCommandMenu("viewer");
      await settleUntil("viewer menu open", (frame) =>
        frame.includes("↑↓ navigate")
      );
      expect(state.commandMenuOpen()).toBe(true);

      // Moving the caret to another line (as a click there would) drifts the guarded
      // Caret, so the menu closes on its own.
      state.setCursorRow(0);
      await settleUntil(
        "viewer menu closed",
        (frame) => !frame.includes("↑↓ navigate")
      );
      expect(state.commandMenuOpen()).toBe(false);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("right-click focuses a tree file and a left click opens it", async () => {
    const repoRoot = createFixtureRepo("stet-cmd-tree-open-", {
      "a.txt": "alpha\n",
      "b.txt": "beta\n",
    });

    const scope = { kind: "all", ref: "HEAD" } as const;
    const model = await loadModel(repoRoot, scope);
    seedState(model, scope);

    const { renderer, renderOnce, captureCharFrame, mockMouse, mockInput } =
      await testRender(() => <App />, { height: 24, width: 100 });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      const tree = await settleUntil("tree shows the files", (frame) =>
        frame.includes("b.txt")
      );

      const row = treeRowOf(tree, "b.txt");
      await mockMouse.click(5, row, MouseButton.RIGHT);
      await settleUntil("menu open", (frame) => frame.includes("Copy path"));

      expect(state.commandMenuItems()[0]?.action).toMatchObject({
        kind: "copyReference",
        path: "b.txt",
      });
      expect(state.selectedPath()).toBe("a.txt");

      mockInput.pressEscape();
      await settleUntil("menu closed", (frame) => !frame.includes("Copy path"));
      await mockMouse.click(5, row);
      expect(state.selectedPath()).toBe("b.txt");

      mockInput.pressKey("<");
      expect(state.selectedPath()).toBe("a.txt");
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("opening the viewer menu on an off-screen caret does not trap the keyboard", async () => {
    const lines = Array.from(
      { length: 120 },
      (_, i) => `const line_${i + 1} = ${i + 1}`
    );

    const repoRoot = createFixtureRepo("stet-cmd-offscreen-", {
      "long.ts": `${lines.join("\n")}\n`,
    });

    const scope = { kind: "all", ref: "HEAD" } as const;
    const model = await loadModel(repoRoot, scope);
    seedState(model, scope);

    const { renderer, renderOnce, captureCharFrame, mockMouse } =
      await testRender(() => <App />, {
        height: 34,
        useMouse: true,
        width: 120,
      });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil(
        "file content",
        (frame) => frame.includes("line_1 ="),
        5
      );

      // Wheel-scroll deep so the top-line caret leaves the viewport (the wheel moves
      // The window, not the caret, and the follow never snaps it back).
      await mockMouse.moveTo(90, 20);

      for (let tick = 0; tick < 20; tick += 1) {
        // oxlint-disable-next-line no-await-in-loop -- one wheel tick per render pass
        await mockMouse.scroll(90, 20, "down");
        // oxlint-disable-next-line no-await-in-loop -- one wheel tick per render pass
        await renderOnce();
      }

      expect(state.viewerScrollTop()).toBeGreaterThan(0);

      // The caret is now off-screen, so the viewer menu cannot anchor: opening it must
      // Not leave it stuck open (which would swallow every key until escape).
      state.openCommandMenu("viewer");
      await settleUntil(
        "menu did not stay open",
        () => !state.commandMenuOpen()
      );
      expect(state.commandMenuOpen()).toBe(false);
    } finally {
      renderer.destroy();
    }
  }, 20_000);
});
