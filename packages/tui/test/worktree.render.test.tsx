import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { testRender } from "@opentui/solid";

import { App } from "@/App";

import { createFixtureRepo, loadModel, makeSettleUntil, runGit, seedState } from "./helpers";

describe("worktree picker", () => {
  test("opens with w, escape keeps the current worktree, enter switches the whole app", async () => {
    const repoRoot = createFixtureRepo("stet-worktree-", {
      "README.md": "# Fixture\n",
      "src/main-only.ts": "export const main = true\n",
    });
    const linkedRoot = join(repoRoot, ".wt");
    runGit(repoRoot, ["worktree", "add", "-b", "side-branch", linkedRoot]);
    writeFileSync(join(linkedRoot, "side-only.ts"), "export const side = true\n");
    writeFileSync(join(repoRoot, "src", "main-only.ts"), "export const main = false\n");

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    const { renderer, renderOnce, captureCharFrame, mockInput } = await testRender(() => <App />, {
      height: 34,
      width: 120,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      const initial = await settleUntil(
        "app chrome",
        (frame) => frame.includes("q quit") && frame.includes("main-only.ts"),
        5,
      );
      expect(initial).toContain("main-only.ts");
      expect(initial).not.toContain("side-only.ts");

      mockInput.pressKey("w");
      const picker = await settleUntil(
        "worktree picker",
        (frame) => frame.includes("switch worktree") && frame.includes("side-branch"),
      );
      expect(picker).toContain("side-branch");

      mockInput.pressEscape();
      const closed = await settleUntil("picker closed", (frame) => !frame.includes("side-branch"));
      expect(closed).toContain("main-only.ts");
      expect(closed).not.toContain("side-only.ts");

      mockInput.pressKey("w");
      await settleUntil("worktree picker again", (frame) => frame.includes("side-branch"));
      mockInput.pressArrow("down");
      // Let the cursor move commit before enter, as a real key cadence would
      await settleUntil("picker cursor moved", () => true, 2);
      mockInput.pressEnter();
      const switched = await settleUntil(
        "linked worktree loaded",
        (frame) =>
          frame.includes("side-only.ts") &&
          frame.includes("side-branch") &&
          frame.includes("uncommitted vs HEAD"),
      );
      expect(switched).toContain("side-only.ts");
      expect(switched).toContain("side-branch");
      expect(switched).toContain("uncommitted vs HEAD");
    } finally {
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
    }
  }, 20_000);

  test("each row says how much work sits in that worktree and how recently it moved", async () => {
    const repoRoot = createFixtureRepo("stet-worktree-activity-", { "README.md": "# Fixture\n" });
    // Outside the repo, so the main worktree reads as genuinely clean: a nested worktree is an
    // Untracked entry in its parent (real setups gitignore theirs, as this repo does).
    const linkedRoot = `${repoRoot}-linked`;
    runGit(repoRoot, ["worktree", "add", "-b", "busy-branch", linkedRoot]);
    writeFileSync(join(linkedRoot, "one.ts"), "export const one = 1\n");
    writeFileSync(join(linkedRoot, "two.ts"), "export const two = 2\n");

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    const { renderer, renderOnce, captureCharFrame, mockInput } = await testRender(() => <App />, {
      height: 34,
      width: 120,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil("app chrome", (frame) => frame.includes("q quit"), 5);

      mockInput.pressKey("w");
      const picker = await settleUntil(
        "worktree summaries",
        (frame) => frame.includes("busy-branch") && frame.includes("2 changed"),
      );

      // The worktree an agent just wrote in reads as work plus a fresh age; the one nobody has
      // Touched reads as clean. `relativeTime` calls anything under a minute "now".
      expect(picker).toContain("2 changed");
      expect(picker).toContain("now");
      expect(picker).toContain("clean");
    } finally {
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
      rmSync(linkedRoot, { force: true, recursive: true });
    }
  }, 20_000);

  test("the header says another worktree is active while you inspect this one", async () => {
    const repoRoot = createFixtureRepo("stet-worktree-cue-", { "README.md": "# Fixture\n" });
    const linkedRoot = `${repoRoot}-linked`;
    runGit(repoRoot, ["worktree", "add", "-b", "other-branch", linkedRoot]);
    writeFileSync(join(linkedRoot, "agent-work.ts"), "export const work = 1\n");

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    const { renderer, renderOnce, captureCharFrame } = await testRender(() => <App />, {
      height: 34,
      width: 120,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      // No keypress: the background poll finds the churn in the other worktree on its own.
      const frame = await settleUntil(
        "header cue",
        (candidate) => candidate.includes("1 worktree active"),
        40,
      );
      expect(frame).toContain("1 worktree active");
    } finally {
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
      rmSync(linkedRoot, { force: true, recursive: true });
    }
  }, 20_000);

  test("typing filters the worktree list", async () => {
    const repoRoot = createFixtureRepo("stet-worktree-filter-", {
      "README.md": "# Fixture\n",
    });
    const linkedRoot = join(repoRoot, ".wt");
    runGit(repoRoot, ["worktree", "add", "-b", "side-branch", linkedRoot]);

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    const { renderer, renderOnce, captureCharFrame, mockInput } = await testRender(() => <App />, {
      height: 34,
      width: 120,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil("app chrome", (frame) => frame.includes("q quit"), 5);

      mockInput.pressKey("w");
      await settleUntil("worktree picker", (frame) => frame.includes("side-branch"));

      await mockInput.typeText("branch");
      const filtered = await settleUntil("filtered to side-branch", (frame) =>
        frame.includes("side-branch"),
      );
      expect(filtered).toContain("side-branch");

      await mockInput.typeText("zzz");
      const empty = await settleUntil(
        "no matches",
        (frame) => frame.includes("no matches") && !frame.includes("side-branch"),
      );
      expect(empty).toContain("no matches");
    } finally {
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
    }
  }, 20_000);
});
