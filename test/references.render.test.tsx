import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { testRender } from "@opentui/solid";

import { App } from "@/App";
import { state } from "@/state";

import { createFixtureRepo, loadModel, makeSettleUntil, seedState } from "./helpers";

// A `.txt` fixture has no language server advertising `references`, so the pull resolves
// Empty without spawning one: this stays off a real server (env-dependent, slow, and it
// Would pollute the shared runtime), the way intel-service.test.ts covers the pull itself
// Against a fake peer. The point here is the overlay surface: it opens on the request,
// Renders its empty screen with the shared footer, and closes on escape.
describe("references overlay", () => {
  test("opens on find-references, renders the empty screen, and closes on escape", async () => {
    const repoRoot = createFixtureRepo("sideye-references-", {
      "notes.txt": "alpha beta\n",
      "package.json": `${JSON.stringify({ scripts: { lint: "exit 0", typecheck: "exit 0" } })}\n`,
    });
    writeFileSync(join(repoRoot, "notes.txt"), "alpha beta\ngamma delta\n");

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    const { renderer, renderOnce, captureCharFrame, mockInput } = await testRender(() => <App />, {
      height: 30,
      width: 110,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil("caret on the added line", (frame) => /ln 2:1\b/.test(frame));
      mockInput.pressTab();

      void state.findReferences();
      // No capable server for a `.txt`, so the request resolves in place to the empty
      // Screen, which still carries the family's instruction-hint footer.
      const empty = await settleUntil("empty screen", (frame) => frame.includes("no references"));
      expect(empty).toContain("↑↓ navigate");

      mockInput.pressEscape();
      const closed = await settleUntil(
        "overlay closed",
        (frame) => !frame.includes("no references"),
      );
      expect(closed).not.toContain("↑↓ navigate");
    } finally {
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
    }
  }, 20_000);

  test("closes when the repoRoot changes under it (a worktree switch)", async () => {
    const repoRoot = createFixtureRepo("sideye-references-", {
      "notes.txt": "alpha beta\n",
      "package.json": `${JSON.stringify({ scripts: { lint: "exit 0", typecheck: "exit 0" } })}\n`,
    });
    writeFileSync(join(repoRoot, "notes.txt"), "alpha beta\ngamma delta\n");
    const otherRoot = createFixtureRepo("sideye-references-other-", { "readme.md": "other\n" });

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    const { renderer, renderOnce, captureCharFrame, mockInput } = await testRender(() => <App />, {
      height: 30,
      width: 110,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil("caret on the added line", (frame) => /ln 2:1\b/.test(frame));
      mockInput.pressTab();

      void state.findReferences();
      await settleUntil("overlay open", (frame) => frame.includes("no references"));

      // The same seam switchWorktree commits (setRepoRoot); the overlay's results belong
      // To the old repo, so the drift effect closes it rather than leaving stale paths.
      state.setRepoRoot(otherRoot);
      const closed = await settleUntil(
        "overlay closed by the repo change",
        (frame) => !frame.includes("no references"),
      );
      expect(closed).not.toContain("↑↓ navigate");
    } finally {
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
      rmSync(otherRoot, { force: true, recursive: true });
    }
  }, 20_000);
});
