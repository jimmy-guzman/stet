import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { testRender } from "@opentui/solid";

import { App } from "@/App";
import {
  registerServers,
  resolveServers,
  restoreServers,
  snapshotServers,
} from "@/diagnostics/servers";
import { state } from "@/state";

import { createFixtureRepo, loadModel, makeSettleUntil, seedState } from "./helpers";

// A `.txt` fixture has no language server advertising `references`, so the pull resolves
// Empty without spawning one: this stays off a real server (env-dependent, slow, and it
// Would pollute the shared runtime), the way intel-service.test.ts covers the pull itself
// Against a fake peer. The point here is the overlay surface: it opens on the request,
// Renders its empty screen with the shared footer, and closes on escape.
describe("references overlay", () => {
  test("opens on find-references, renders the empty screen, and closes on escape", async () => {
    const repoRoot = createFixtureRepo("stet-references-", {
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
    const repoRoot = createFixtureRepo("stet-references-", {
      "notes.txt": "alpha beta\n",
      "package.json": `${JSON.stringify({ scripts: { lint: "exit 0", typecheck: "exit 0" } })}\n`,
    });
    writeFileSync(join(repoRoot, "notes.txt"), "alpha beta\ngamma delta\n");
    const otherRoot = createFixtureRepo("stet-references-other-", { "readme.md": "other\n" });

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

  test("a failed pull names the failure instead of the generic unreachable copy", async () => {
    const snapshot = snapshotServers();
    const repoRoot = createFixtureRepo("stet-references-", {
      "package.json": `${JSON.stringify({ scripts: { lint: "exit 0", typecheck: "exit 0" } })}\n`,
      "src/a.ts": "const x = 1\n",
    });
    writeFileSync(join(repoRoot, "src/a.ts"), "const x = 1\nconst y = x\n");

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    const { renderer, renderOnce, captureCharFrame } = await testRender(() => <App />, {
      height: 30,
      width: 110,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      // A references-capable server stet cannot bring up: the acquire fails, and the point is
      // That the overlay repeats what actually went wrong instead of the old fixed copy, which
      // Claimed an unreachable server for every failure and read as "intel is broken".
      const resolved = resolveServers({
        typescript: { capabilities: ["references"], command: [join(repoRoot, "no-such-server")] },
      });
      expect(resolved.issues).toEqual([]);
      registerServers(resolved.servers);
      await settleUntil("tree loaded", (frame) => frame.includes("a.ts"));

      void state.findReferences();
      const failed = await settleUntil("failure named in the overlay", (frame) =>
        frame.includes("no language server for typescript"),
      );
      expect(failed).not.toContain("language server unreachable");
    } finally {
      renderer.destroy();
      restoreServers(snapshot);
      rmSync(repoRoot, { force: true, recursive: true });
    }
  }, 20_000);

  test("previews fill in place for the visible window after the overlay opens", async () => {
    const repoRoot = createFixtureRepo("stet-references-", {
      "notes.txt": "alpha beta\n",
      "package.json": `${JSON.stringify({ scripts: { lint: "exit 0", typecheck: "exit 0" } })}\n`,
    });
    writeFileSync(join(repoRoot, "notes.txt"), "alpha beta\ngamma delta\n");

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    const { renderer, renderOnce, captureCharFrame } = await testRender(() => <App />, {
      height: 30,
      width: 110,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil("caret on the added line", (frame) => /ln 2:1\b/.test(frame));

      // The pull now opens the overlay with blank previews; the windowed fill owns the text. The
      // Target is a file the diff view is not showing, so its line can only come from the fill.
      state.openReferences("references", [{ column: 1, line: 1, path: "package.json", text: "" }]);
      await settleUntil("overlay open", (frame) => frame.includes("↑↓ navigate"));
      await settleUntil("preview filled from disk", (frame) => frame.includes('{"scripts"'));
    } finally {
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
    }
  }, 20_000);

  test("scrolls the viewport to follow the cursor past the visible window", async () => {
    const repoRoot = createFixtureRepo("stet-references-", {
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

      // Seed enough results across files to overflow the 14-row viewport, each with a
      // Unique marker so scroll position reads straight off the captured char frame.
      const results = Array.from({ length: 5 }, (_file, file) =>
        Array.from({ length: 6 }, (_row, row) => {
          const n = file * 6 + row;
          return {
            column: 1,
            line: row + 1,
            path: `src/file${file}.ts`,
            text: `marker_${String(n).padStart(3, "0")}`,
          };
        }),
      ).flat();
      state.openReferences("references", results);

      const top = await settleUntil("overlay open at the top", (frame) =>
        frame.includes("marker_000"),
      );
      expect(top).not.toContain("marker_029");

      // Ctrl-n is down in the references keymap; drive the cursor to the last result.
      for (let i = 0; i < 29; i += 1) {
        mockInput.pressKey("n", { ctrl: true });
      }

      // The fix: the viewport follows the cursor, so the last result is now on screen and
      // The first file has scrolled out. Under the bug the highlight moved but the window
      // Stayed put, so marker_029 never entered the frame.
      const scrolled = await settleUntil("viewport followed the cursor", (frame) =>
        frame.includes("marker_029"),
      );
      expect(scrolled).not.toContain("marker_000");
    } finally {
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
    }
  }, 20_000);
});
