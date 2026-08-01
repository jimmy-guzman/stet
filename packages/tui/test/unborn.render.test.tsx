import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { testRender } from "@opentui/solid";

import { App } from "@/App";
import { EMPTY_TREE_SHA } from "@/git/model";
import { state } from "@/state";
import { stripGitEnv } from "@/utils/env";

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

// The other direction, which only a failed read can reveal: `git checkout --orphan` takes HEAD's
// Meaning away mid-session, and `git diff HEAD` then fails on every tick. Left unrepaired the tree
// Freezes at its pre-checkout state with no alert.
test("a mid-session orphan checkout re-points the base onto the empty tree", async () => {
  const repo = createUnbornRepo("unborn-orphan-");
  try {
    writeFileSync(join(repo, "a.txt"), "one\n");
    runGit(repo, ["add", "a.txt"]);
    runGit(repo, ["commit", "-m", "first"]);
    writeFileSync(join(repo, "a.txt"), "one\ntwo\n");

    const allScope = { kind: "all", ref: "HEAD" } as const;
    seedState(await loadModel(repo, allScope), allScope);

    const { renderer, renderOnce, captureCharFrame } = await testRender(() => <App />, {
      height: 24,
      width: 100,
    });
    try {
      const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });
      await settleUntil("edited file", (current) => current.includes("1 changed"));

      // Let the fs.watch subscription arm; the safety poll backstops within the window.
      await new Promise((resolve) => setTimeout(resolve, 200));
      runGit(repo, ["checkout", "--orphan", "fresh"]);

      const frame = await settleUntil("orphan base", (current) =>
        current.includes("no commits yet"),
      );

      expect(frame).toContain("a.txt");
      expect(state.scope().ref).toBe(EMPTY_TREE_SHA);
    } finally {
      renderer.destroy();
    }
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});

// `last-commit` diffs its parent against the literal HEAD, so an unborn one leaves it with no side
// To diff at all. It falls back to the default lens, the same thing a worktree switch into an
// Orphan checkout already did.
test("a mid-session orphan checkout drops the last-commit scope to all", async () => {
  const repo = createUnbornRepo("unborn-orphan-last-");
  try {
    writeFileSync(join(repo, "a.txt"), "one\n");
    runGit(repo, ["add", "a.txt"]);
    runGit(repo, ["commit", "-m", "first"]);
    writeFileSync(join(repo, "a.txt"), "one\ntwo\n");
    runGit(repo, ["commit", "-am", "second"]);

    const parent = execFileSync("git", ["rev-parse", "HEAD~1"], {
      cwd: repo,
      encoding: "utf8",
      env: stripGitEnv(process.env),
    }).trim();
    const lastCommitScope = { headRef: "HEAD", kind: "last-commit", ref: parent } as const;
    seedState(await loadModel(repo, lastCommitScope), lastCommitScope);
    // A range scope's ref is a parent SHA, not the CLI ref `seedState` mirrors off it.
    state.setCliBaseRef("HEAD");

    const { renderer, renderOnce, captureCharFrame } = await testRender(() => <App />, {
      height: 24,
      width: 100,
    });
    try {
      const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });
      await settleUntil("last commit", (current) => current.includes("last commit"));

      // Let the fs.watch subscription arm; the safety poll backstops within the window.
      await new Promise((resolve) => setTimeout(resolve, 200));
      runGit(repo, ["checkout", "--orphan", "fresh"]);

      await settleUntil("dropped to all", () => state.scope().kind === "all");

      expect(state.scope().ref).toBe(EMPTY_TREE_SHA);
    } finally {
      renderer.destroy();
    }
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});
