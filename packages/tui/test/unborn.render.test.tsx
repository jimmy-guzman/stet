import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { testRender } from "@opentui/solid";

import { App } from "@/App";
import { EMPTY_TREE_SHA } from "@/git/model";
import { state } from "@/state";

import { loadModel, makeSettleUntil, runGit, seedState } from "./helpers";

// A repository with no commits, seeded the way main.tsx does: the scope carries the resolved base
// (the empty tree, since there is no HEAD to diff against) while `cliBaseRef` keeps the ref the
// User named, which is what the base returns to once a commit exists.
const unbornScope = { kind: "all", ref: EMPTY_TREE_SHA } as const;

function createUnbornRepo(prefix: string) {
  const repo = mkdtempSync(join(tmpdir(), prefix));
  runGit(repo, ["init"]);
  return repo;
}

test("a repository with no commits opens with its files read as added", async () => {
  const repo = createUnbornRepo("unborn-render-");
  try {
    writeFileSync(join(repo, "staged.txt"), "one\n");
    writeFileSync(join(repo, "loose.txt"), "two\n");
    runGit(repo, ["add", "staged.txt"]);

    seedState(await loadModel(repo, unbornScope), unbornScope);
    state.setCliBaseRef("HEAD");
    state.setHeadUnborn(true);

    const { renderer, renderOnce, captureCharFrame } = await testRender(() => <App />, {
      height: 24,
      width: 100,
    });
    try {
      const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });
      const frame = await settleUntil("tree", (current) => current.includes("staged.txt"));

      expect(frame).toContain("loose.txt");
      expect(frame).toContain("2 changed");
    } finally {
      renderer.destroy();
    }
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});

// The empty-tree base is transient. Committing gives HEAD a meaning, and the refresh drain has to
// Return `all` to it: left pinned, the whole tree would keep reading as added forever.
test("the first commit re-points the base off the empty tree", async () => {
  const repo = createUnbornRepo("unborn-commit-");
  try {
    writeFileSync(join(repo, "staged.txt"), "one\n");
    runGit(repo, ["add", "staged.txt"]);

    seedState(await loadModel(repo, unbornScope), unbornScope);
    state.setCliBaseRef("HEAD");
    state.setHeadUnborn(true);

    const { renderer, renderOnce, captureCharFrame } = await testRender(() => <App />, {
      height: 24,
      width: 100,
    });
    try {
      const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });
      await settleUntil("added file", (current) => current.includes("1 changed"));

      // Let the fs.watch subscription arm; the safety poll backstops within the window.
      await new Promise((resolve) => setTimeout(resolve, 200));
      runGit(repo, ["commit", "-m", "first"]);

      const frame = await settleUntil("committed tree", (current) => current.includes("0 changed"));

      expect(frame).toContain("staged.txt");
      expect(state.scope().ref).toBe("HEAD");
    } finally {
      renderer.destroy();
    }
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});
