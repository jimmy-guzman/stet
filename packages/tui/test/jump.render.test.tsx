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

describe("view toggle jumps", () => {
  test("v returns to the diff even from a line outside every hunk", async () => {
    const lines = Array.from(
      { length: 30 },
      (_, index) => `const line${index + 1} = ${index + 1}`
    );

    const repoRoot = createFixtureRepo("stet-jump-", {
      "package.json": `${JSON.stringify({ scripts: { lint: "exit 0", typecheck: "exit 0" } })}\n`,
      "src/a.ts": `${lines.join("\n")}\n`,
    });

    writeFileSync(
      path.join(repoRoot, "src", "a.ts"),
      `${["const line1 = 1", "const changed = true", ...lines.slice(2)].join("\n")}\n`
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
      // Diff view shows the add/remove stats; full-file view shows "N lines".
      await settleUntil(
        "diff view",
        (frame) =>
          /[+-]\d+\s*$/u.test(frame.split("\n")[state.layout().viewer.y] ?? ""),
        5
      );

      // Focus the viewer, switch to file view, and move far away from the hunk
      mockInput.pressTab();
      mockInput.pressKey("v");
      await settleUntil("file view", (frame) => /\d+ lines/u.test(frame));

      // Plain j presses: ctrl-d (0x04) is not delivered on every platform
      for (const _ of lines) {
        mockInput.pressKey("j");
      }

      await settleUntil(
        "cursor at end of file",
        (frame) => /\d+ lines/u.test(frame) && state.cursorLineNumber() === 30
      );

      // Toggling back must land on the nearest hunk line, not bounce to file view
      mockInput.pressKey("v");

      const after = await settleUntil("diff view again", (frame) =>
        /[+-]\d+\s*$/u.test(frame.split("\n")[state.layout().viewer.y] ?? "")
      );

      expect(after.split("\n")[state.layout().viewer.y]).not.toMatch(/lines/u);
    } finally {
      renderer.destroy();
    }
  }, 20_000);
});
