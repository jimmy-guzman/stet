import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { testRender } from "@opentui/solid";

import { App } from "../src/App";
import { createFixtureRepo, loadModel, makeSettleUntil, seedState } from "./helpers";

describe("word caret", () => {
  test("h/l hop the caret word to word and wrap across lines, shown as ln L:C", async () => {
    // Two changed lines so the line number distinguishes a wrap; "const a = 1"
    // Has words at columns 1 (const), 7 (a), 11 (1).
    const repoRoot = createFixtureRepo("sideye-caret-", {
      "package.json": `${JSON.stringify({ scripts: { lint: "exit 0", typecheck: "exit 0" } })}\n`,
      "src/a.ts": "const a = 1\nconst b = 1\n",
    });
    writeFileSync(join(repoRoot, "src", "a.ts"), "const a = 2\nconst b = 2\n");

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    const { renderer, renderOnce, captureCharFrame, mockInput } = await testRender(() => <App />, {
      height: 30,
      width: 110,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      // The caret homes to the first line's first word: ln 1, column 1.
      await settleUntil("caret at first word", (frame) => /ln 1:1\b/.test(frame));

      mockInput.pressTab();
      mockInput.pressKey("l");
      await settleUntil("caret on the second word", (frame) => /ln 1:7\b/.test(frame));

      mockInput.pressKey("l");
      await settleUntil("caret on the third word", (frame) => /ln 1:11\b/.test(frame));

      // Past the last word, l wraps to the next line's first word.
      mockInput.pressKey("l");
      await settleUntil("caret wraps to the next line", (frame) => /ln 2:1\b/.test(frame));

      // H past the first word wraps back to the previous line's last word.
      mockInput.pressKey("h");
      const back = await settleUntil("caret wraps back", (frame) => /ln 1:11\b/.test(frame));
      expect(back).toMatch(/ln 1:11\b/);
    } finally {
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
    }
  }, 20_000);
});
