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

      const savedColumn = state.caretColumn();
      state.selectFile("src/other.ts");
      await settleUntil(
        "second file opened",
        () => state.diffView()?.path === "src/other.ts"
      );
      mockInput.pressKey("<");

      const restored = await settleUntil(
        "returned to the diff",
        () =>
          state.diffView()?.path === "src/mod.ts" &&
          state.pendingRestore() === undefined
      );

      expect(state.fileView()).toBe(false);
      expect(state.cursorLineNumber()).toBe(10);
      expect(state.caretColumn()).toBe(savedColumn);
      expect(restored).toContain("const l10 = 10");
    } finally {
      renderer.destroy();
    }
  }, 20_000);
});
