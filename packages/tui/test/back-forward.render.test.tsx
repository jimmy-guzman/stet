import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { testRender } from "@opentui/solid";
import { batch } from "solid-js";

import { App } from "@/app";
import { MAX_FILE_LINES } from "@/file/content";
import { state } from "@/state";

import {
  createFixtureRepo,
  loadModel,
  makeSettleUntil,
  seedState,
} from "./helpers";

describe("back / forward navigation", () => {
  test("restores the file and the cursor line you left", async () => {
    const body = Array.from(
      { length: 30 },
      (_, index) => `const line${index + 1} = ${index + 1}`
    );

    const repoRoot = createFixtureRepo("stet-backfwd-", {
      "package.json": `${JSON.stringify({ scripts: { lint: "exit 0", typecheck: "exit 0" } })}\n`,
      "src/a.ts": `${body.join("\n")}\n`,
      "src/b.ts": `${body.join("\n")}\n`,
    });

    // Edit both so each renders a hunk away from line 1.
    writeFileSync(
      path.join(repoRoot, "src", "a.ts"),
      `${["const line1 = 1", "const aChanged = true", ...body.slice(2)].join("\n")}\n`
    );
    writeFileSync(
      path.join(repoRoot, "src", "b.ts"),
      `${["const line1 = 1", "const bChanged = true", ...body.slice(2)].join("\n")}\n`
    );

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });

    const { renderer, renderOnce, captureCharFrame, mockInput } =
      await testRender(() => <App />, {
        height: 34,
        width: 120,
      });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil(
        "diff view",
        () => state.cursorLineNumber() !== undefined,
        5
      );

      // Open a.ts and move the cursor down inside it, away from the first change.
      state.selectFile("src/a.ts");

      await settleUntil(
        "a.ts open",
        (frame) =>
          frame.includes("src/a.ts") && state.cursorLineNumber() !== undefined
      );

      const startLn = state.cursorLineNumber();
      state.setFocusedPane("diff");
      mockInput.pressKey("j");
      await renderOnce();
      mockInput.pressKey("j");

      await settleUntil(
        "cursor moved",
        (frame) =>
          frame.includes("src/a.ts") &&
          state.cursorLineNumber() !== undefined &&
          state.cursorLineNumber() !== startLn
      );

      const movedLn = state.cursorLineNumber();
      expect(movedLn).not.toBe(startLn);

      // Jump away to b.ts (records a.ts's cursor on leave).
      state.selectFile("src/b.ts");
      await settleUntil(
        "b.ts open",
        (frame) =>
          frame.includes("src/b.ts") && state.cursorLineNumber() !== undefined
      );

      // Back returns to a.ts at the exact line we left.
      state.goBack();

      await settleUntil(
        "back on a.ts",
        (frame) =>
          frame.includes("src/a.ts") && state.cursorLineNumber() === movedLn
      );

      expect(state.cursorLineNumber()).toBe(movedLn);

      mockInput.pressKey("k");
      await settleUntil(
        "caret moved after going back",
        () => state.cursorLineNumber() !== movedLn
      );
      const reopenedLine = state.cursorLineNumber();
      const reopenedRow = state.cursorLineContent();
      state.setCaretLineLevel(true);
      state.openSearch();
      state.selectFile("src/a.ts");
      expect(state.mainView()).toBe("file");
      await settleUntil(
        "reopened a.ts",
        () => state.pendingRestore() === undefined
      );
      expect(state.cursorLineNumber()).toBe(reopenedLine);
      expect(state.cursorLineContent()).toBe(reopenedRow);
      expect(state.caretColumn()).toBeUndefined();
      expect(state.canGoForward()).toBe(true);

      // Forward returns to b.ts.
      state.goForward();
      await settleUntil(
        "forward on b.ts",
        (frame) =>
          frame.includes("src/b.ts") && state.cursorLineNumber() !== undefined
      );
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("back restores each jump's own target line within one file", async () => {
    const body = Array.from(
      { length: 30 },
      (_, index) => `const line${index + 1} = ${index + 1}`
    );

    const repoRoot = createFixtureRepo("stet-samefile-jump-", {
      "package.json": `${JSON.stringify({ scripts: { lint: "exit 0", typecheck: "exit 0" } })}\n`,
      "src/c.ts": `${body.join("\n")}\n`,
    });

    // Two hunks far apart (lines 2 and 27), so both jump lines are navigable in the diff.
    writeFileSync(
      path.join(repoRoot, "src", "c.ts"),
      `${[
        "const line1 = 1",
        "const early = true",
        ...body.slice(2, 26),
        "const late = true",
        ...body.slice(27),
      ].join("\n")}\n`
    );

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });

    const { renderer, renderOnce, captureCharFrame } = await testRender(
      () => <App />,
      {
        height: 34,
        width: 120,
      }
    );

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil(
        "caret on the old side of line 2",
        () =>
          state.pendingRestore() === undefined &&
          state.cursorLineContent() === "const line2 = 2"
      );

      // Jump to line 2, then jump to line 27 in the same file (a distinct entry).
      state.selectFile("src/c.ts", { escalate: true, line: 2 });
      await settleUntil(
        "first jump",
        (frame) => frame.includes("src/c.ts") && state.cursorLineNumber() === 2
      );
      state.selectFile("src/c.ts", { escalate: true, line: 27 });
      await settleUntil(
        "second jump",
        (frame) => frame.includes("src/c.ts") && state.cursorLineNumber() === 27
      );

      // Back must land on the first jump's line (2), not the file's first change.
      state.goBack();

      await settleUntil(
        "back to first jump line",
        (frame) => frame.includes("src/c.ts") && state.cursorLineNumber() === 2
      );

      expect(state.cursorLineNumber()).toBe(2);
      expect(state.cursorLineContent()).toBe("const early = true");

      state.goBack();
      await settleUntil(
        "back to the old side of line 2",
        () => state.cursorLineContent() === "const line2 = 2"
      );
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("rapid navigation restores unfinished jumps", async () => {
    const repoRoot = createFixtureRepo("stet-pending-jumps-", {
      "a.ts": "const start = 0\n",
      "b.ts": `${"const filler = 0\n".repeat(MAX_FILE_LINES)}const first = 1\n`,
      "c.ts": "const first = 1\nconst second = 2\n",
    });

    const scope = { kind: "all", ref: "HEAD" } as const;
    seedState(await loadModel(repoRoot, scope), scope);

    const { renderer, renderOnce, captureCharFrame } = await testRender(
      () => <App />,
      { height: 24, width: 100 }
    );

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil(
        "initial file loaded",
        () => state.diffView()?.path === "a.ts"
      );

      batch(() => {
        state.selectFile("b.ts", { column: 7, line: MAX_FILE_LINES + 1 });
        state.selectFile("c.ts", { column: 7, line: 1 });
        state.goBack();
      });
      await settleUntil(
        "older cross-file jump restored",
        () =>
          state.diffView()?.path === "b.ts" &&
          state.pendingRestore() === undefined
      );
      expect(state.cursorLineNumber()).toBe(MAX_FILE_LINES + 1);
      expect(state.caretColumn()).toBe(7);

      batch(() => {
        state.selectFile("c.ts", { column: 7, line: 1 });
        state.selectFile("c.ts", { column: 7, line: 2 });
        state.goBack();
      });
      await settleUntil(
        "older same-file jump restored",
        () =>
          state.diffView()?.path === "c.ts" &&
          state.pendingRestore() === undefined
      );
      expect(state.cursorLineNumber()).toBe(1);
      expect(state.caretColumn()).toBe(7);

      batch(() => {
        state.selectFile("a.ts", { column: 7, line: 1 });
        state.selectFile("b.ts");
        state.selectFile("a.ts");
      });
      await settleUntil(
        "direct reopen completes the unfinished jump",
        () =>
          state.diffView()?.path === "a.ts" &&
          state.pendingRestore() === undefined
      );
      expect(state.cursorLineNumber()).toBe(1);
      expect(state.caretColumn()).toBe(7);
    } finally {
      renderer.destroy();
    }
  }, 20_000);
});
