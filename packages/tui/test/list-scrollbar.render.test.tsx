import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { rgbToHex, ScrollBoxRenderable } from "@opentui/core";
import type { CapturedFrame, Renderable } from "@opentui/core";
import { MouseButtons } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";

import { App } from "@/app";
import { ListScrollbar } from "@/components/list-scrollbar";
import { state } from "@/state";
import { theme } from "@/theme/context";
import { toCodePoints } from "@/utils/text";

import {
  createFixtureRepo,
  loadModel,
  makeSettleUntil,
  seedState,
} from "./helpers";

/** The rows of a pane's last column that its scrollbar thumb covers. */
const thumbRows = (
  frame: string,
  {
    height,
    width,
    x,
    y,
  }: { height: number; width: number; x: number; y: number }
) =>
  frame
    .split("\n")
    .slice(y, y + height)
    .flatMap((row, index) =>
      /[█▀▄]/u.test(toCodePoints(row)[x + width - 1] ?? "") ? [index] : []
    );

const tree = (frame: string) =>
  thumbRows(frame, state.layout().sidebar.content);

const results = (frame: string) =>
  thumbRows(frame, state.layout().viewer.content);

const bigDirectory = (count: number) =>
  Object.fromEntries(
    Array.from({ length: count }, (_, i) => [
      `big/f${String(i).padStart(3, "0")}.txt`,
      `content ${i}\n`,
    ])
  );

// The foreground of one cell. Spans carry no column, so a row is spread into one color per cell.
const fgAt = (frame: CapturedFrame, x: number, y: number) =>
  (frame.lines[y]?.spans ?? []).flatMap((span) =>
    Array.from({ length: span.width }, () => rgbToHex(span.fg))
  )[x];

const scrollboxes = (root: Renderable): ScrollBoxRenderable[] => [
  ...(root instanceof ScrollBoxRenderable ? [root] : []),
  ...root.getChildren().flatMap(scrollboxes),
];

// The windowed lists mount only their visible slice, so their scrollbar is a standalone one fed the
// List's own numbers. Each fixture overflows one list only, which proves that list wired its own.
const scope = { kind: "all", ref: "HEAD" } as const;

describe("list scrollbar", () => {
  test("shows a thumb only when the tree overflows, and it tracks scroll", async () => {
    const repoRoot = createFixtureRepo("stet-scrollbar-", bigDirectory(300));
    const model = await loadModel(repoRoot, scope);
    seedState(model, scope);

    const { renderer, mockInput, renderOnce, captureCharFrame } =
      await testRender(() => <App />, { height: 16, width: 90 });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil("first render", (current) =>
        current.includes("f000.txt")
      );

      expect(tree(captureCharFrame())[0]).toBe(0);

      for (let i = 0; i < 80; i += 1) {
        mockInput.pressKey("j");
        // oxlint-disable-next-line no-await-in-loop -- sequential nav steps
        await renderOnce();
      }

      await settleUntil("thumb moved", (frame) => (tree(frame)[0] ?? 0) > 0);

      // Collapsing the directory leaves fewer rows than the viewport: the column
      // Stays reserved but paints no thumb.
      for (let i = 0; i < 90; i += 1) {
        mockInput.pressKey("k");
        // oxlint-disable-next-line no-await-in-loop -- sequential nav steps
        await renderOnce();
      }

      mockInput.pressKey("h");
      await settleUntil("no thumb", (frame) => tree(frame).length === 0);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("a track click that closes the context menu scrolls nothing", async () => {
    const repoRoot = createFixtureRepo("stet-scrollbar-", bigDirectory(300));
    seedState(await loadModel(repoRoot, scope), scope);

    const { renderer, mockMouse, renderOnce, captureCharFrame } =
      await testRender(() => <App />, { height: 16, width: 90 });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil("first render", (current) =>
        current.includes("f000.txt")
      );

      const { height, width, x, y } = state.layout().sidebar.content;
      await mockMouse.click(x + 2, y + 1, MouseButtons.RIGHT);
      await settleUntil("menu", () => state.commandMenuOpen());

      await mockMouse.click(x + width - 1, y + height - 1);
      await settleUntil("menu closed", () => !state.commandMenuOpen());
      expect(state.sidebarScrollTop()).toBe(0);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("dragging the thumb scrolls the tree, and a track click jumps", async () => {
    const repoRoot = createFixtureRepo("stet-scrollbar-", bigDirectory(300));
    seedState(await loadModel(repoRoot, scope), scope);

    const { renderer, mockMouse, renderOnce, captureCharFrame } =
      await testRender(() => <App />, { height: 16, width: 90 });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil("first render", (current) =>
        current.includes("f000.txt")
      );

      const { height, width, x, y } = state.layout().sidebar.content;
      const column = x + width - 1;
      const last = state.treeRowCount() - height;

      // Any other button is the pane's, and scrolls nothing.
      state.setFocusedPane("diff");
      await mockMouse.click(column, y + height - 1, MouseButtons.RIGHT);
      await renderOnce();
      expect(state.sidebarScrollTop()).toBe(0);
      expect(state.focusedPane()).toBe("tree");

      state.setFocusedPane("diff");
      // The thumb moves by half cells, so the end is a drag past the last row.
      await mockMouse.drag(column, y, column, y + height);
      await settleUntil("dragged to the end", (frame) =>
        frame.includes("f299.txt")
      );
      expect(state.sidebarScrollTop()).toBe(last);
      expect(state.focusedPane()).toBe("tree");

      await mockMouse.click(column, y + Math.floor(height / 2));
      await settleUntil("jumped", () => state.sidebarScrollTop() < last);
      expect(state.sidebarScrollTop()).toBeGreaterThan(0);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("the tree's thumb lights under the pointer and through a drag", async () => {
    const repoRoot = createFixtureRepo("stet-scrollbar-", bigDirectory(300));
    seedState(await loadModel(repoRoot, scope), scope);

    const { renderer, mockMouse, renderOnce, captureCharFrame, captureSpans } =
      await testRender(() => <App />, { height: 16, width: 90 });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil("first render", (current) =>
        current.includes("f000.txt")
      );

      const { width, x, y } = state.layout().sidebar.content;
      const column = x + width - 1;

      // Whether every cell the thumb covers, wherever it has scrolled to, paints in `color`.
      const thumbIs = (color: string) => {
        const frame = captureSpans();
        const rows = tree(captureCharFrame());

        return (
          rows.length > 0 &&
          rows.every((row) => fgAt(frame, column, y + row) === color)
        );
      };

      expect(thumbIs(theme.colors.scrollbar.thumb)).toBe(true);

      await mockMouse.moveTo(column, y + 1);
      await settleUntil("lit", () => thumbIs(theme.colors.scrollbar.active));

      await mockMouse.moveTo(x + 2, y + 1);
      await settleUntil("unlit", () => thumbIs(theme.colors.scrollbar.thumb));

      // A drag keeps it lit after the pointer leaves the column, until the next move off it.
      await mockMouse.moveTo(column, y);
      await mockMouse.pressDown(column, y);
      await mockMouse.moveTo(x + 2, y + 3);
      await settleUntil("scrolled", () => state.sidebarScrollTop() > 0);
      expect(thumbIs(theme.colors.scrollbar.active)).toBe(true);

      await mockMouse.release(x + 2, y + 3);
      await mockMouse.moveTo(x + 3, y + 3);
      await settleUntil("unlit after the drag", () =>
        thumbIs(theme.colors.scrollbar.thumb)
      );
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("an overlay's native scrollbar lights under the pointer", async () => {
    const repoRoot = createFixtureRepo("stet-scrollbar-help-", {
      "a.txt": "a\n",
    });

    seedState(await loadModel(repoRoot, scope), scope);

    const {
      renderer,
      mockInput,
      mockMouse,
      renderOnce,
      captureCharFrame,
      captureSpans,
    } = await testRender(() => <App />, { height: 16, width: 90 });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil("first render", (current) => current.includes("a.txt"));
      mockInput.pressKey("?");
      await settleUntil("help overlay", (frame) =>
        frame.includes("navigation")
      );

      const [list] = scrollboxes(renderer.root);
      const bar = list?.verticalScrollBar;
      expect(bar?.visible).toBe(true);

      const column = bar?.x ?? 0;
      const top = bar?.y ?? 0;
      const span = { height: bar?.height ?? 0, width: 1, x: column, y: top };

      // Whether every cell the thumb covers, wherever it has scrolled to, paints in `color`.
      const thumbIs = (color: string) => {
        const frame = captureSpans();
        const rows = thumbRows(captureCharFrame(), span);

        return (
          rows.length > 0 &&
          rows.every((row) => fgAt(frame, column, top + row) === color)
        );
      };

      expect(thumbIs(theme.colors.scrollbar.thumb)).toBe(true);

      await mockMouse.moveTo(column, top + 1);
      await settleUntil("lit", () => thumbIs(theme.colors.scrollbar.active));

      // Over the rows beside it, the bar is dark again.
      await mockMouse.moveTo(column - 4, top + 1);
      await settleUntil("unlit", () => thumbIs(theme.colors.scrollbar.thumb));

      // A drag keeps it lit after the pointer leaves the bar, until the next move off it.
      await mockMouse.moveTo(column, top);
      await mockMouse.pressDown(column, top);
      await mockMouse.moveTo(column - 4, top + 3);
      await settleUntil("scrolled", () => (list?.scrollTop ?? 0) > 0);
      expect(thumbIs(theme.colors.scrollbar.active)).toBe(true);

      await mockMouse.release(column - 4, top + 3);
      await mockMouse.moveTo(column - 5, top + 3);
      await settleUntil("unlit after the drag", () =>
        thumbIs(theme.colors.scrollbar.thumb)
      );
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("the thumb covers the visible share of the list, however the list got there", async () => {
    const [list, setList] = createSignal({ rows: 0, top: 0, viewport: 20 });

    const { renderer, renderOnce, captureCharFrame } = await testRender(
      () => (
        <ListScrollbar
          rowCount={() => list().rows}
          viewport={() => list().viewport}
          scrollTop={() => list().top}
          setScrollTop={(top) => {
            setList((current) => ({ ...current, top }));
          }}
        />
      ),
      { height: 20, width: 4 }
    );

    const thumb = async (rows: number, viewport: number) => {
      setList({ rows, top: 0, viewport });
      await renderOnce();

      return thumbRows(captureCharFrame(), {
        height: viewport,
        width: 1,
        x: 0,
        y: 0,
      }).length;
    };

    try {
      // Rows arrive after the pane, as a deferred load does.
      expect(await thumb(0, 20)).toBe(0);
      expect(await thumb(40, 20)).toBe(10);
      // Most of it visible, then all of it, then back.
      expect(await thumb(25, 20)).toBe(16);
      expect(await thumb(20, 20)).toBe(0);
      expect(await thumb(40, 20)).toBe(10);
      expect(await thumb(40, 10)).toBe(3);
      expect(await thumb(100_000, 20)).toBe(1);
    } finally {
      renderer.destroy();
    }
  });

  test("a list that shrinks with its pane keeps the position it was given", async () => {
    const [list, setList] = createSignal({ rows: 100, top: 30, viewport: 40 });

    const { renderer, renderOnce } = await testRender(
      () => (
        <ListScrollbar
          rowCount={() => list().rows}
          viewport={() => list().viewport}
          scrollTop={() => list().top}
          setScrollTop={(top) => {
            setList((current) => ({ ...current, top }));
          }}
        />
      ),
      { height: 40, width: 4 }
    );

    try {
      await renderOnce();
      setList({ rows: 50, top: 30, viewport: 10 });
      await renderOnce();
      expect(list().top).toBe(30);
    } finally {
      renderer.destroy();
    }
  });

  test("shows a thumb in the search results and tracks scroll", async () => {
    const repoRoot = createFixtureRepo("stet-scrollbar-search-", {
      "src/many.ts": "seed\n",
    });

    const lines = Array.from(
      { length: 60 },
      (_, index) => `const needle${index} = ${index}`
    );

    writeFileSync(
      path.join(repoRoot, "src", "many.ts"),
      `${lines.join("\n")}\n`
    );
    const model = await loadModel(repoRoot, scope);
    seedState(model, scope);

    const { renderer, mockInput, mockMouse, renderOnce, captureCharFrame } =
      await testRender(() => <App />, { height: 34, width: 120 });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil("app chrome", (frame) => frame.includes("q quit"), 5);
      mockInput.pressKey("f", { ctrl: true });
      await settleUntil("search pane", (frame) => frame.includes("search…"));
      await mockInput.typeText("needle");
      await settleUntil("results", (frame) =>
        frame.includes("60 matches in 1 file")
      );

      // 60 matches overflow the results band; the sidebar has one file, so the
      // Only thumb in the frame is the search pane's.
      const [topRow] = results(captureCharFrame());
      expect(topRow).toBeGreaterThanOrEqual(0);

      for (let i = 0; i < 10; i += 1) {
        // oxlint-disable-next-line no-await-in-loop -- sequential wheel steps
        await mockMouse.scroll(state.layout().viewer.x + 10, 12, "down");
        // oxlint-disable-next-line no-await-in-loop -- sequential wheel steps
        await renderOnce();
      }

      await renderOnce();
      expect(results(captureCharFrame())[0]).toBeGreaterThan(topRow ?? 0);
    } finally {
      renderer.destroy();
    }
  }, 20_000);
});
