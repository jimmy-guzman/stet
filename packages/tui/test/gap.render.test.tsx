import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { testRender } from "@opentui/solid";

import { App } from "@/app";
import { state } from "@/state";

import {
  createFixtureRepo,
  cursorLineContent,
  loadModel,
  makeSettleUntil,
  runGit,
  seedState,
} from "./helpers";

describe("gap expansion", () => {
  test("z reveals an unchanged gap and Back restores a saved line inside it", async () => {
    // Twenty flat lines (no indentation, so nothing folds); changing only the first
    // And last leaves a wide unchanged middle that git elides into one gap.
    const lines = Array.from(
      { length: 20 },
      (_, index) => `const l${index + 1} = ${index + 1}`
    );

    const source = `${lines.join("\n")}\n`;

    const repoRoot = createFixtureRepo("stet-gap-", {
      "package.json": `${JSON.stringify({ scripts: { lint: "exit 0", typecheck: "exit 0" } })}\n`,
      "src/mod.ts": source,
      "src/other.ts": "export const other = true;\n",
    });

    const edited = source
      .replace("const l1 = 1", "const l1 = 100")
      .replace("const l20 = 20", "const l20 = 200");

    writeFileSync(path.join(repoRoot, "src", "mod.ts"), edited);

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });

    const { renderer, renderOnce, captureCharFrame, mockInput, mockMouse } =
      await testRender(() => <App />, {
        height: 30,
        width: 110,
      });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      // The middle is collapsed into a gap marker; a mid-file line is not shown yet.
      const collapsed = await settleUntil("gap marker shown", (frame) =>
        frame.includes("unmodified lines")
      );

      expect(collapsed).not.toContain("const l10 = 10");

      // Put the caret on the last line (below the gap), then expand the gap above it.
      // The revealed lines are inserted above the caret; it must stay on line 20, not
      // Shift up by the number of revealed lines.
      mockInput.pressTab();
      mockInput.pressKey("G");
      await settleUntil(
        "caret on last line",
        () => state.cursorLineNumber() === 20
      );
      mockInput.pressKey("z");

      // The diff already carries the gap's lines, so the reveal lands on the very next
      // Frame, with nothing left to load.
      await renderOnce();
      const expanded = captureCharFrame();

      expect(expanded).toContain("const l10 = 10");
      expect(state.cursorLineNumber()).toBe(20);

      const lineY = expanded
        .split("\n")
        .findIndex((line) => line.includes("const l10 = 10"));

      await mockMouse.click(state.layout().viewer.x + 14, lineY);
      expect(state.cursorLineNumber()).toBe(10);

      state.selectFile("src/other.ts");
      await settleUntil(
        "second file opened",
        () => state.diffView()?.path === "src/other.ts"
      );
      mockInput.pressKey("<");

      await settleUntil(
        "restored line visible in the diff",
        (frame) =>
          state.diffView()?.path === "src/mod.ts" &&
          state.pendingRestore() === undefined &&
          frame.includes("const l10 = 10")
      );

      expect(state.fileView()).toBe(false);
      expect(state.cursorLineNumber()).toBe(10);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("Back reveals a gap containing a saved old-side line after a scope change", async () => {
    const lines = Array.from(
      { length: 100 },
      (_, index) => `const line${index + 1} = ${index + 1}`
    );

    const repoRoot = createFixtureRepo("stet-old-gap-", {
      "mod.ts": `${lines.join("\n")}\n`,
      "other.ts": "export const other = true\n",
    });

    const file = path.join(repoRoot, "mod.ts");
    writeFileSync(file, `${lines.toSpliced(9, 1).join("\n")}\n`);
    runGit(repoRoot, ["add", "mod.ts"]);

    // Restore the deleted line and shift it beyond the first hunk's new-side
    // context. Old line 10 is in the gap, while new line 10 is already visible.
    const inserted = Array.from(
      { length: 12 },
      (_, index) => `const added${index + 1} = true`
    );

    const edited = [...inserted, ...lines.with(99, "const changed = 100")];
    writeFileSync(file, `${edited.join("\n")}\n`);

    const scope = { kind: "staged", ref: "HEAD" } as const;
    seedState(await loadModel(repoRoot, scope), scope);

    const { renderer, renderOnce, captureCharFrame, mockInput } =
      await testRender(() => <App />, { height: 30, width: 110 });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil(
        "caret on the staged deletion",
        () =>
          state.pendingRestore() === undefined &&
          cursorLineContent() === "const line10 = 10"
      );
      expect(state.navigableLines()[state.cursorIndex()]?.type).toBe("remove");

      state.selectFile("other.ts");
      await settleUntil(
        "second file opened",
        () => state.diffView()?.path === "other.ts"
      );
      state.selectScope("all");
      await settleUntil(
        "all scope loaded",
        () => state.gitModel().scopeKey === "all:HEAD:"
      );

      mockInput.pressKey("<");

      await settleUntil(
        "restored line visible in the diff",
        (frame) =>
          state.diffView()?.path === "mod.ts" &&
          state.pendingRestore() === undefined &&
          frame.includes("const line10 = 10")
      );

      expect(state.cursorLineNumber()).toBe(22);
      expect(cursorLineContent()).toBe("const line10 = 10");
      expect(state.fileView()).toBe(false);
    } finally {
      renderer.destroy();
    }
  }, 20_000);
});
