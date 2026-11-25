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

// A long unchanged file viewed as full content. The viewer mounts only a windowed
// Row slice, so a scroll offset that the window can't follow leaves the lower pane
// Blank. These two cases guard the two writers of that offset: the mouse wheel and
// Keyboard cursor-follow.
const longFileRepo = (prefix: string) => {
  const lines = Array.from(
    { length: 120 },
    (_, i) => `const line_${i + 1} = ${i + 1}`
  );

  return createFixtureRepo(prefix, { "long.ts": `${lines.join("\n")}\n` });
};

const visibleLineNumbers = (frame: string) =>
  (frame.match(/line_\d+ =/gu) ?? []).map((match) =>
    Number(match.replaceAll(/\D/gu, ""))
  );

describe("diff viewer vertical scroll", () => {
  test("wheel-down scrolls deep and keeps the viewport full of real lines", async () => {
    const repoRoot = longFileRepo("stet-wheel-");
    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });

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

      await mockMouse.moveTo(90, 20);

      for (let tick = 0; tick < 40; tick += 1) {
        // oxlint-disable-next-line no-await-in-loop -- one wheel tick per render pass
        await mockMouse.scroll(90, 20, "down");
        // oxlint-disable-next-line no-await-in-loop -- one wheel tick per render pass
        await renderOnce();
      }

      const numbers = visibleLineNumbers(captureCharFrame());

      // Scrolled well past the first screen (cursor-follow must not yank it back)...
      expect(Math.min(...numbers)).toBeGreaterThan(30);
      // ...and the viewport is packed with real lines, not an empty bottom spacer.
      expect(numbers.length).toBeGreaterThan(20);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("keyboard cursor-follow still drives the scroll (G to bottom, g to top)", async () => {
    const repoRoot = longFileRepo("stet-curfollow-");
    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    state.setFocusedPane("diff");

    const { renderer, renderOnce, captureCharFrame, mockInput } =
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

      mockInput.pressKey("G");
      await settleUntil("bottom", (frame) => frame.includes("line_120 ="));

      mockInput.pressKey("g");

      const top = await settleUntil(
        "top",
        (frame) => frame.includes("line_1 =") && !frame.includes("line_120 =")
      );

      expect(top).toContain("line_1 =");
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("stepping down one line at a time keeps the cursor line on screen", async () => {
    const repoRoot = longFileRepo("stet-step-");
    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    state.setFocusedPane("diff");

    const { renderer, renderOnce, captureCharFrame, mockInput } =
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

      // Walk the cursor down one line per render pass; it must never leave the
      // Viewport (the reported bug: the highlight scrolls off the bottom edge).
      for (let step = 0; step < 60; step += 1) {
        mockInput.pressKey("j");
        // oxlint-disable-next-line no-await-in-loop -- one cursor step per render pass
        await renderOnce();
        const cursorLine = state.cursorLineNumber();
        expect(captureCharFrame()).toContain(`line_${cursorLine} =`);
      }
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("going back to a file that shrank shows its content, not the space past it", async () => {
    const repoRoot = longFileRepo("stet-shrunk-");
    writeFileSync(path.join(repoRoot, "other.ts"), "const other = 1\n");
    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });

    const { renderer, renderOnce, captureCharFrame } = await testRender(
      () => <App />,
      { height: 34, width: 120 }
    );

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      state.selectFile("long.ts");
      await settleUntil("long file", (frame) => frame.includes("line_1 ="), 5);

      // The caret stays on the first line; only the viewport moves, as the wheel moves it.
      state.setViewerScrollTop(80);
      await settleUntil("scrolled", (frame) => frame.includes("line_100 ="));

      // A position past the end stops where the last line fills the viewport.
      state.setViewerScrollTop(10_000);

      const end = await settleUntil("stopped at the end", (frame) =>
        frame.includes("line_120 =")
      );

      expect(visibleLineNumbers(end)).toHaveLength(state.viewerHeight());

      state.selectFile("other.ts");
      await settleUntil("other file", (frame) => frame.includes("other = 1"));
      writeFileSync(path.join(repoRoot, "long.ts"), "const line_1 = 1\n");

      state.goBack();
      await settleUntil(
        "shrunken file",
        (frame) => frame.includes("line_1 =") && !frame.includes("line_100 =")
      );
      expect(state.viewerScrollTop()).toBe(0);
    } finally {
      renderer.destroy();
    }
  }, 20_000);
});
