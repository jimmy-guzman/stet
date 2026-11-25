import { describe, expect, test } from "bun:test";
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
  recordClipboard,
  seedState,
} from "./helpers";

const scope = { kind: "all", ref: "HEAD" } as const;

/** One long changed line whose far end carries a marker no viewport starts with. */
const longLine = `const alpha = "${"x".repeat(300)} faraway";`;

const mountChanged = async (prefix: string, before: string, after: string) => {
  const repoRoot = createFixtureRepo(prefix, { "src/a.ts": before });
  writeFileSync(path.join(repoRoot, "src", "a.ts"), after);
  seedState(await loadModel(repoRoot, scope), scope);

  const app = await testRender(() => <App />, { height: 20, width: 100 });

  return { ...app, settleUntil: makeSettleUntil(app) };
};

describe("line cursor", () => {
  // Neither pane has a frame, so the lit cursor is the focus mark: the viewer paints its caret
  // Line only while it holds focus, as the tree paints its cursor row.
  test("the caret line is lit only while the viewer is focused", async () => {
    const { captureSpans, mockInput, renderer, settleUntil } =
      await mountChanged(
        "stet-cursor-focus-",
        "const a = 1\n",
        "const a = 2\n"
      );

    // A fresh open homes to the first change, the removed line.
    const caretLineBackground = () => {
      const line = captureSpans().lines.find(({ spans }) =>
        spans
          .map((span) => span.text)
          .join("")
          .includes("const a = 1")
      );

      return line?.spans.find((span) => span.text.includes("const"))?.bg;
    };

    try {
      await settleUntil("diff loaded", (frame) =>
        frame.includes("const a = 2")
      );
      expect(state.focusedPane()).toBe("tree");
      const unlit = caretLineBackground()?.toInts();

      mockInput.pressTab();
      await settleUntil(
        "lit on focus",
        () => String(caretLineBackground()?.toInts()) !== String(unlit)
      );
      const lit = caretLineBackground()?.toInts();

      // The find bar acts on the viewer, so it keeps the viewer's focus and its caret line.
      mockInput.pressKey("/");
      await settleUntil("find bar open", () => state.findOpen());
      expect(caretLineBackground()?.toInts()).toEqual(lit);
      mockInput.pressEscape();
      await settleUntil("find bar closed", () => !state.findOpen());

      mockInput.pressTab();
      await settleUntil(
        "unlit on blur",
        () => String(caretLineBackground()?.toInts()) === String(unlit)
      );
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("a click anywhere on a line places the cursor there, and y copies path:line", async () => {
    const copied = recordClipboard();

    const { mockInput, mockMouse, renderer, settleUntil } = await mountChanged(
      "stet-cursor-click-",
      "const a = 1\n",
      "const a = 1\nconst b = 2\nconst c = 3\n"
    );

    try {
      const frame = await settleUntil("diff loaded", (current) =>
        current.includes("const c = 3")
      );

      const rowOf = (text: string) =>
        frame.split("\n").findIndex((row) => row.includes(text));

      await mockMouse.click(state.layout().viewer.x + 12, rowOf("const b = 2"));
      await settleUntil("cursor on b", () => state.cursorLineNumber() === 2);
      mockInput.pressKey("y");

      // The gutter is part of the line, not a different mode.
      await mockMouse.click(state.layout().viewer.x + 1, rowOf("const c = 3"));
      await settleUntil("cursor on c", () => state.cursorLineNumber() === 3);
      mockInput.pressKey("y");

      expect(copied).toEqual(["src/a.ts:2", "src/a.ts:3"]);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("h and l scroll a long line, stop at both ends, and do nothing when wrapped", async () => {
    const { mockInput, renderer, settleUntil } = await mountChanged(
      "stet-cursor-scroll-",
      "const a = 1\n",
      `${longLine}\n`
    );

    try {
      await settleUntil("diff loaded", (frame) =>
        frame.includes("const alpha")
      );
      mockInput.pressTab();
      mockInput.pressKey("h");
      expect(state.viewerScrollX()).toBe(0);

      mockInput.pressKey("l");
      expect(state.viewerScrollX()).toBe(4);
      await settleUntil("scrolled", (frame) => frame.includes("t alpha"));

      for (let presses = 0; presses < 200; presses += 1) {
        mockInput.pressKey("l");
      }

      await settleUntil("far end", (frame) => frame.includes('faraway";'));
      const end = state.viewerScrollX();
      mockInput.pressKey("l");
      expect(state.viewerScrollX()).toBe(end);

      mockInput.pressKey("x");
      await settleUntil("wrapped", () => state.overflow() === "wrap");
      const wrapped = state.viewerScrollX();
      mockInput.pressKey("h");
      expect(state.viewerScrollX()).toBe(wrapped);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("a jump to a column scrolls it into view", async () => {
    const { renderer, settleUntil } = await mountChanged(
      "stet-cursor-jump-",
      "const a = 1\n",
      `${longLine}\nconst b = 2\n`
    );

    try {
      await settleUntil("diff loaded", (frame) =>
        frame.includes("const alpha")
      );
      state.selectFile("src/a.ts", {
        column: longLine.indexOf("faraway") + 1,
        line: 1,
      });
      await settleUntil("column revealed", (frame) =>
        frame.includes("faraway")
      );

      // The request is spent, so scrolling away afterwards holds.
      state.setViewerScrollX(0);
      await settleUntil("scrolled back", (frame) =>
        frame.includes("const alpha")
      );
      expect(state.viewerScrollX()).toBe(0);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test.each([
    ["text", "alpha beta gamma"],
    ["pattern", "alpha.*gamma"],
  ])(
    "opening a %s search result shows the whole match",
    async (kind, query) => {
      const { mockInput, renderer, settleUntil } = await mountChanged(
        "stet-cursor-phrase-",
        "const a = 1\n",
        `${"pad ".repeat(60)}alpha beta gamma\n`
      );

      try {
        await settleUntil("diff loaded", (frame) => frame.includes("pad pad"));
        mockInput.pressKey("f", { ctrl: true });
        await settleUntil("search", (frame) => frame.includes("search…"));

        if (kind === "pattern") {
          mockInput.pressKey("r", { ctrl: true });
        }

        await mockInput.typeText(query);
        await settleUntil("result", (frame) =>
          frame.includes("1 match in 1 file")
        );
        mockInput.pressEnter();
        await settleUntil(
          "whole match shown",
          (frame) =>
            state.mainView() === "file" && frame.includes("alpha beta gamma")
        );
      } finally {
        renderer.destroy();
      }
    },
    20_000
  );

  test("the viewer measures again when the terminal answers how wide a cluster is", async () => {
    const { captureCharFrame, mockInput, renderer, settleUntil } =
      await mountChanged(
        "stet-cursor-width-",
        "const a = 1\n",
        `${"👨‍👩‍👧".repeat(60)}\nconst b = 2\n`
      );

    const furthest = () => {
      for (let presses = 0; presses < 150; presses += 1) {
        mockInput.pressKey("l");
      }

      return state.viewerScrollX();
    };

    const rowOfNext = () =>
      captureCharFrame()
        .split("\n")
        .findIndex((row) => row.includes("const b"));

    try {
      await settleUntil("diff loaded", (frame) => frame.includes("const b"));
      mockInput.pressTab();
      const narrow = furthest();
      mockInput.pressKey("x");
      await settleUntil("wrapped", () => state.overflow() === "wrap");
      const before = rowOfNext();

      // The same cluster is three times as wide to this terminal.
      Object.defineProperty(renderer, "widthMethod", { value: "wcwidth" });
      renderer.emit("capabilities");
      await settleUntil("wrapped again", () => rowOfNext() > before);

      mockInput.pressKey("x");
      await settleUntil("unwrapped", () => state.overflow() === "scroll");
      expect(furthest()).toBeGreaterThan(narrow);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("a find match is scrolled into view from either side", async () => {
    const { mockInput, renderer, settleUntil } = await mountChanged(
      "stet-cursor-find-",
      "const a = 1\n",
      `${longLine}\nconst b = 2\n`
    );

    try {
      await settleUntil("diff loaded", (frame) =>
        frame.includes("const alpha")
      );
      mockInput.pressTab();
      mockInput.pressKey("/");
      await settleUntil("find open", () => state.findOpen());
      await mockInput.typeText("faraway");
      mockInput.pressEnter();
      await settleUntil("match on the right shown", (frame) =>
        frame.includes('faraway";')
      );
      mockInput.pressEscape();

      mockInput.pressKey("/");
      await settleUntil("find open again", () => state.findOpen());
      await mockInput.typeText("const b");
      mockInput.pressEnter();
      await settleUntil("match on the left shown", (frame) =>
        frame.includes("const b = 2")
      );
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("a find match is shown inside a word wider than the viewer, and in full", async () => {
    const { mockInput, renderer, settleUntil } = await mountChanged(
      "stet-cursor-wide-",
      "const a = 1\n",
      `${"a".repeat(500)}NEEDLE${"b".repeat(500)}\n${"pad ".repeat(60)}alpha beta gamma\n`
    );

    const findText = async (text: string) => {
      mockInput.pressKey("/");
      await settleUntil("find open", () => state.findOpen());
      await mockInput.typeText(text);
      mockInput.pressEnter();
      // Only the code rows: the find bar above them shows the query whatever happened.
      await settleUntil(`${text} shown`, (frame) =>
        frame
          .split("\n")
          .slice(state.layout().viewer.content.y + 1)
          .join("\n")
          .includes(text)
      );
      mockInput.pressEscape();
    };

    try {
      await settleUntil("diff loaded", (frame) => frame.includes("aaaa"));
      mockInput.pressTab();
      await findText("NEEDLE");
      await findText("alpha beta gamma");
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("extending a selection inside a wide word keeps its end on screen", async () => {
    const { mockInput, renderer, settleUntil } = await mountChanged(
      "stet-cursor-extend-",
      "const a = 1\n",
      `${"a".repeat(600)}\n`
    );

    try {
      await settleUntil("diff loaded", (frame) => frame.includes("aaaa"));

      const index = state
        .navigableLines()
        .findIndex((line) => line.type === "add");

      state.setFocusedPane("diff");
      state.setViewerScrollX(100);
      state.select({
        anchor: { column: 110, index },
        focus: { column: 120, index },
        unit: "character",
      });
      mockInput.pressArrow("right", { shift: true });
      await settleUntil(
        "extended",
        () => state.viewerSelection()?.focus.column === 121
      );
      expect(state.viewerScrollX()).toBe(100);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("the context menu opens while scrolled sideways, at the cell that was right-clicked", async () => {
    const { mockInput, mockMouse, renderer, settleUntil } = await mountChanged(
      "stet-cursor-menu-",
      "const a = 1\n",
      `${longLine}\n`
    );

    try {
      const frame = await settleUntil("diff loaded", (current) =>
        current.includes("const alpha")
      );

      mockInput.pressTab();
      state.setViewerScrollX(40);
      state.openCommandMenu("viewer");
      await settleUntil("keyboard menu shown", (current) =>
        current.includes("Copy reference")
      );
      mockInput.pressEscape();
      await settleUntil("menu closed", () => !state.commandMenuOpen());

      const clickX = state.layout().viewer.x + 20;

      const row = frame
        .split("\n")
        .findIndex((line) => line.includes("const alpha"));

      await mockMouse.click(clickX, row, MouseButton.RIGHT);

      const menu = await settleUntil("mouse menu shown", (current) =>
        current.includes("Copy reference")
      );

      expect(menu.split("\n")[row + 1]?.indexOf("┌")).toBe(clickX);
    } finally {
      renderer.destroy();
    }
  }, 20_000);
});
