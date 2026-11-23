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
  runGit,
  seedState,
} from "./helpers";

// A file longer than the render cap loads partially; the viewer surfaces that in a
// Reserved footer at the content (not the transient status bar), and `f` loads the
// Rest. The hidden-line count is asserted against the model the footer renders from
// So the arithmetic stays honest without hardcoding the caps.
describe("truncation footer", () => {
  test("shows the hidden-line count and clears it when f loads the full file", async () => {
    const big = `${Array.from({ length: 6000 }, (_, index) => `line ${index}`).join("\n")}\n`;

    const repoRoot = createFixtureRepo("stet-trunc-", {
      "big.txt": big,
      "package.json": `${JSON.stringify({ name: "trunc-fixture" })}\n`,
    });

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    state.selectFile("big.txt");

    const { renderer, renderOnce, captureCharFrame, mockInput } =
      await testRender(() => <App />, {
        height: 30,
        width: 110,
      });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      const shown = await settleUntil("truncation footer", (frame) =>
        frame.includes("more lines · f to load")
      );

      expect(state.truncatedHidden()).toBeGreaterThan(0);
      expect(shown).toContain(
        `⋯ ${state.truncatedHidden()} more lines · f to load`
      );

      mockInput.pressKey("f");

      const loaded = await settleUntil(
        "footer clears after loading full content",
        (frame) => !frame.includes("f to load")
      );

      expect(loaded).not.toContain("f to load");
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("Back loads the rest of a larger diff after a scope change hides the saved line", async () => {
    const targetLine = 1800;

    const lines = Array.from(
      { length: targetLine },
      (_, index) => `const line${index + 1} = 0`
    );

    const repoRoot = createFixtureRepo("stet-trunc-restore-", {
      "mod.ts": `${lines.join("\n")}\n`,
      "other.ts": "export const other = true\n",
    });

    const file = path.join(repoRoot, "mod.ts");
    const staged = lines.with(targetLine - 1, "const target = 1");
    writeFileSync(file, `${staged.join("\n")}\n`);
    runGit(repoRoot, ["add", "mod.ts"]);

    // These earlier edits consume the diff's row budget in the all-changes scope.
    const edited = staged.map((line, index) =>
      index < 900 ? line.replace(" = 0", " = 2") : line
    );

    writeFileSync(file, `${edited.join("\n")}\n`);
    const scope = { kind: "staged", ref: "HEAD" } as const;
    seedState(await loadModel(repoRoot, scope), scope);

    const { renderer, renderOnce, captureCharFrame, mockInput } =
      await testRender(() => <App />, { height: 30, width: 110 });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      state.selectFile("mod.ts", { column: 7, line: targetLine });
      await settleUntil(
        "saved line in the staged diff",
        () =>
          state.cursorLineContent() === "const target = 1" &&
          state.caretColumn() === 7
      );
      expect(state.truncated()).toBe(false);

      state.selectFile("other.ts");
      await settleUntil(
        "opened another file",
        () => state.diffView()?.path === "other.ts"
      );
      state.selectScope("all");
      await settleUntil(
        "all scope loaded",
        () => state.gitModel().scopeKey === "all:HEAD:"
      );

      mockInput.pressKey("<");
      await settleUntil(
        "returned to the diff",
        () =>
          state.diffView()?.path === "mod.ts" &&
          state.pendingRestore() === undefined
      );

      expect(state.cursorLineNumber()).toBe(targetLine);
      expect(state.caretColumn()).toBe(7);
      expect(state.fileView()).toBe(false);
      expect(state.truncated()).toBe(false);
    } finally {
      renderer.destroy();
    }
  }, 20_000);
});
