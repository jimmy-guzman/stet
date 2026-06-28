import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { testRender } from "@opentui/solid";

import { App } from "../src/App";
import { createFixtureRepo, loadModel, makeSettleUntil, seedState } from "./helpers";

describe("word caret", () => {
  test("h/l hop the caret word to word, shown as ln L:C", async () => {
    // A one-line change so the cursor lands on it; "const a = 1" has words at
    // Columns 1 (const), 7 (a), 11 (1).
    const repoRoot = createFixtureRepo("sideye-caret-", {
      "package.json": `${JSON.stringify({ scripts: { lint: "exit 0", typecheck: "exit 0" } })}\n`,
      "src/a.ts": "const a = 1\n",
    });
    writeFileSync(join(repoRoot, "src", "a.ts"), "const a = 2\n");

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    const { renderer, renderOnce, captureCharFrame, mockInput } = await testRender(() => <App />, {
      height: 30,
      width: 110,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      // The caret homes to the line's first word, so the location reads :1.
      await settleUntil("caret at first word", (frame) => /ln \d+:1\b/.test(frame));

      mockInput.pressTab();
      mockInput.pressKey("l");
      await settleUntil("caret on the second word", (frame) => /ln \d+:7\b/.test(frame));

      mockInput.pressKey("l");
      await settleUntil("caret on the third word", (frame) => /ln \d+:11\b/.test(frame));

      // At the last word, l stays put; h hops back.
      mockInput.pressKey("l");
      await settleUntil("caret stays on the last word", (frame) => /ln \d+:11\b/.test(frame));
      mockInput.pressKey("h");
      const back = await settleUntil("caret hops back", (frame) => /ln \d+:7\b/.test(frame));
      expect(back).toMatch(/ln \d+:7\b/);
    } finally {
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
    }
  }, 20_000);
});
