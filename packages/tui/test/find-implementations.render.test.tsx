import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { testRender } from "@opentui/solid";

import { App } from "@/App";
import { state } from "@/state";

import { createFixtureRepo, loadModel, makeSettleUntil, seedState } from "./helpers";

// A `.txt` fixture has no language server advertising `implementation`, which is also the shape of
// A Python repo on ty (every other intel pull, but not this one). This stays off a real server
// (env-dependent, slow, and it would pollute the shared runtime), the way intel-service.test.ts
// Covers the pull's result branches against a fake peer. Here the point is the state action's own
// Surface: what it says when nothing can answer, and the `implementations` overlay it opens.
describe("find-implementations", () => {
  test("says implementations are unsupported rather than claiming there are none", async () => {
    const repoRoot = createFixtureRepo("stet-impl-", {
      "notes.txt": "alpha\n",
      "package.json": `${JSON.stringify({ name: "impl-fixture" })}\n`,
    });
    writeFileSync(join(repoRoot, "notes.txt"), "alpha\nbravo charlie\n");

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    const { renderer, renderOnce, captureCharFrame } = await testRender(() => <App />, {
      height: 30,
      width: 110,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      // Caret lands on `bravo` (a symbol) on the added line, so the guards pass.
      await settleUntil("caret on the added line", (frame) => /ln 2:1\b/.test(frame));

      // Nothing can answer for a `.txt`, so no request is issued: the in-flight indicator the
      // Action shares with go-to-definition (covered in definition.render.test.tsx, on this same
      // Fixture) never appears, because there is nothing to wait for.
      const pending = state.findImplementations();
      expect(state.statusRight()).not.toContain("resolving implementations…");

      await pending;

      // An empty pull would render as "no implementations", which reads as a claim about the code.
      // The notice names the real reason instead.
      const settled = await settleUntil("status bar shows the unsupported notice", (frame) =>
        frame.includes("ℹ no implementation support for this file type"),
      );
      expect(settled).not.toContain("no implementations");
      expect(state.statusRightLevel()).toBe("info");
    } finally {
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
    }
  }, 20_000);

  test("opens the implementations overlay without the call-hierarchy direction hint", async () => {
    const repoRoot = createFixtureRepo("stet-impl-", {
      "notes.txt": "alpha\n",
      "package.json": `${JSON.stringify({ name: "impl-fixture" })}\n`,
    });
    writeFileSync(join(repoRoot, "notes.txt"), "alpha\nbravo charlie\n");

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    const { renderer, renderOnce, captureCharFrame } = await testRender(() => <App />, {
      height: 30,
      width: 110,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil("caret on the added line", (frame) => /ln 2:1\b/.test(frame));

      // Seed the multi-result overlay directly (like the references viewport test), so the label
      // And footer render without a real server: two concrete bodies of one interface member.
      state.openReferences("implementations", [
        { column: 1, line: 1, path: "src/a.ts", text: "export class A {}" },
        { column: 1, line: 1, path: "src/b.ts", text: "export class B {}" },
      ]);

      const open = await settleUntil("overlay open with the implementations summary", (frame) =>
        frame.includes("2 implementations in 2 files"),
      );
      // The overlay carries the shared footer, but implementations aren't directional, so the
      // `⇥ direction` toggle (call hierarchy's) must not appear.
      expect(open).toContain("⏎ open");
      expect(open).not.toContain("⇥ direction");
    } finally {
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
    }
  }, 20_000);
});
