import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { testRender } from "@opentui/solid";

import { App } from "@/App";
import { state } from "@/state";

import { createFixtureRepo, loadModel, makeSettleUntil, seedState } from "./helpers";

// The in-flight indicator is set synchronously inside `goToDefinition`, before the
// LSP pull is awaited, so this drives the real action but supersedes it with a
// Guard-failing (line-level caret) invocation to abort the pull, keeping the test
// Off a real language server. The pull itself is covered against a fake peer in
// Intel-service.test.ts.
describe("go-to-definition in-flight indicator", () => {
  test("acknowledges F12 instantly over a held notice, then clears when the pull settles", async () => {
    const repoRoot = createFixtureRepo("sideye-def-", {
      "package.json": `${JSON.stringify({ scripts: { lint: "exit 0", typecheck: "exit 0" } })}\n`,
      "src/a.ts": "const alpha = 1\n",
    });
    writeFileSync(join(repoRoot, "src", "a.ts"), "const alpha = 1\nconst added = 2\n");

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    const { renderer, renderOnce, captureCharFrame } = await testRender(() => <App />, {
      height: 30,
      width: 110,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      // Caret lands on `const` (a symbol) on the added line, so the guards pass.
      await settleUntil("caret on the added line", (frame) => /ln 2:1\b/.test(frame));

      // A held acknowledgment occupies the status line first.
      state.notify("held ack");
      expect(state.statusRight()).toContain("held ack");

      // F12 sets the busy indicator synchronously (before any await) and it outranks
      // The held notice: the very keystroke the user is waiting on is acknowledged.
      const pending = state.goToDefinition();
      expect(state.statusRight()).toContain("resolving definition…");
      expect(state.statusRightLevel()).toBe("info");

      // A line-level caret has no symbol, so a superseding F12 aborts the in-flight
      // Pull and returns at the guard without starting a new one (no server needed).
      state.setCaretLineLevel(true);
      const superseded = state.goToDefinition();
      await Promise.all([pending, superseded]);

      // The settled pull cleared the indicator; the status line is no longer busy.
      expect(state.statusRight()).not.toContain("resolving definition…");
    } finally {
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
    }
  }, 20_000);
});
