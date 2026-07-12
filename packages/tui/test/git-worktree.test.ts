import { describe, expect, test } from "bun:test";
import { rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  mergeWorktreeSummaries,
  orderWorktrees,
  parseWorktreeList,
  parseWorktreeStatusPaths,
  summarizeWorktree,
} from "@/git/worktree";
import type { Worktree, WorktreeSummary } from "@/git/worktree";

import { createFixtureRepo, loadWorktrees, loadWorktreeSummaries, runGit } from "./helpers";

function worktree(path: string, branch: string): Worktree {
  return {
    bare: false,
    branch,
    detached: false,
    head: "1111111111111111111111111111111111111111",
    locked: false,
    path,
    prunable: false,
  };
}

function summary(path: string, changed: number, lastActivityAt?: number): WorktreeSummary {
  return { changed, lastActivityAt, path };
}

describe("parseWorktreeList", () => {
  test("parses the main worktree and a linked worktree with branches", () => {
    const output =
      "worktree /repo\0HEAD 1111111111111111111111111111111111111111\0branch refs/heads/main\0\0worktree /repo/.claude/worktrees/feat\0HEAD 2222222222222222222222222222222222222222\0branch refs/heads/feat\0\0";
    expect(parseWorktreeList(output)).toEqual([
      {
        bare: false,
        branch: "main",
        detached: false,
        head: "1111111111111111111111111111111111111111",
        locked: false,
        path: "/repo",
        prunable: false,
      },
      {
        bare: false,
        branch: "feat",
        detached: false,
        head: "2222222222222222222222222222222222222222",
        locked: false,
        path: "/repo/.claude/worktrees/feat",
        prunable: false,
      },
    ]);
  });

  test("marks a detached worktree and leaves branch undefined", () => {
    const output =
      "worktree /repo/spike\0HEAD 3333333333333333333333333333333333333333\0detached\0\0";
    const [entry] = parseWorktreeList(output);
    expect(entry).toMatchObject({
      detached: true,
      head: "3333333333333333333333333333333333333333",
    });
    expect(entry?.branch).toBeUndefined();
  });

  test("marks bare, locked, and prunable entries, with and without reasons", () => {
    const output =
      "worktree /repo.git\0bare\0\0worktree /repo/locked-bare-reason\0HEAD 4444444444444444444444444444444444444444\0branch refs/heads/a\0locked\0\0worktree /repo/locked-with-reason\0HEAD 5555555555555555555555555555555555555555\0branch refs/heads/b\0locked path is on a portable device\0\0worktree /repo/gone\0HEAD 6666666666666666666666666666666666666666\0branch refs/heads/c\0prunable gitdir file points to non-existent location\0\0";
    const [bare, locked, lockedReason, prunable] = parseWorktreeList(output);
    expect(bare).toMatchObject({ bare: true, path: "/repo.git" });
    expect(bare?.branch).toBeUndefined();
    expect(locked).toMatchObject({ locked: true, path: "/repo/locked-bare-reason" });
    expect(lockedReason).toMatchObject({ locked: true, path: "/repo/locked-with-reason" });
    expect(prunable).toMatchObject({ path: "/repo/gone", prunable: true });
  });

  test("skips malformed records and tolerates trailing nuls", () => {
    const output =
      "HEAD 7777777777777777777777777777777777777777\0\0worktree /repo\0HEAD 8888888888888888888888888888888888888888\0branch refs/heads/main\0\0\0";
    const worktrees = parseWorktreeList(output);
    expect(worktrees).toHaveLength(1);
    expect(worktrees[0]).toMatchObject({ branch: "main", path: "/repo" });
  });

  test("returns no worktrees for empty output", () => {
    expect(parseWorktreeList("")).toEqual([]);
  });
});

describe("parseWorktreeStatusPaths", () => {
  test("reads one path per changed file across staged, unstaged, and untracked entries", () => {
    const output = "M  staged.ts\0 M unstaged.ts\0?? new.ts\0MM mixed.ts\0";
    expect(parseWorktreeStatusPaths(output)).toEqual([
      "staged.ts",
      "unstaged.ts",
      "new.ts",
      "mixed.ts",
    ]);
  });

  test("counts a rename once, consuming the original path that trails it", () => {
    const output = "R  new-name.ts\0old-name.ts\0M  other.ts\0";
    expect(parseWorktreeStatusPaths(output)).toEqual(["new-name.ts", "other.ts"]);
  });

  test("counts a copy once, consuming the source path that trails it", () => {
    const output = "C  copy.ts\0source.ts\0";
    expect(parseWorktreeStatusPaths(output)).toEqual(["copy.ts"]);
  });

  test("reads a deleted file, which has no path on disk left to stat", () => {
    expect(parseWorktreeStatusPaths(" D gone.ts\0")).toEqual(["gone.ts"]);
  });

  test("returns nothing for a clean worktree", () => {
    expect(parseWorktreeStatusPaths("")).toEqual([]);
  });
});

describe("summarizeWorktree", () => {
  test("counts the changed files and takes the newest of their mtimes", () => {
    const repoRoot = createFixtureRepo("stet-worktree-summary-", { "a.ts": "const a = 1\n" });
    try {
      writeFileSync(join(repoRoot, "old.ts"), "const old = 1\n");
      writeFileSync(join(repoRoot, "new.ts"), "const fresh = 1\n");
      utimesSync(
        join(repoRoot, "old.ts"),
        new Date(1_000_000_000_000),
        new Date(1_000_000_000_000),
      );
      utimesSync(
        join(repoRoot, "new.ts"),
        new Date(1_700_000_000_000),
        new Date(1_700_000_000_000),
      );

      const result = summarizeWorktree(repoRoot, "?? old.ts\0?? new.ts\0");

      expect(result.changed).toBe(2);
      expect(result.lastActivityAt).toBe(1_700_000_000_000);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test("reports a clean worktree as no changes and no activity", () => {
    expect(summarizeWorktree("/repo", "")).toEqual({
      changed: 0,
      lastActivityAt: undefined,
      path: "/repo",
    });
  });

  test("reports no activity when the only changed file is one that no longer exists", () => {
    expect(summarizeWorktree("/repo", " D gone.ts\0")).toMatchObject({
      changed: 1,
      lastActivityAt: undefined,
    });
  });
});

describe("mergeWorktreeSummaries", () => {
  test("keeps the previous map when nothing moved, so an idle poll wakes nothing", () => {
    const previous = new Map([["/repo", summary("/repo", 2, 1000)]]);
    expect(mergeWorktreeSummaries(previous, [summary("/repo", 2, 1000)])).toBe(previous);
  });

  test("replaces the map when a worktree's activity advances", () => {
    const previous = new Map([["/repo", summary("/repo", 2, 1000)]]);
    const merged = mergeWorktreeSummaries(previous, [summary("/repo", 2, 2000)]);
    expect(merged).not.toBe(previous);
    expect(merged.get("/repo")?.lastActivityAt).toBe(2000);
  });

  test("replaces the map when a worktree appears", () => {
    const previous = new Map([["/repo", summary("/repo", 0)]]);
    const merged = mergeWorktreeSummaries(previous, [summary("/repo", 0), summary("/side", 3, 50)]);
    expect(merged).not.toBe(previous);
    expect(merged.size).toBe(2);
  });
});

describe("orderWorktrees", () => {
  test("pins the main worktree first, then ranks the rest by how recently they moved", () => {
    const list = [
      worktree("/repo/quiet", "quiet"),
      worktree("/repo/hot", "hot"),
      worktree("/repo", "main"),
      worktree("/repo/warm", "warm"),
    ];
    const summaries = new Map([
      ["/repo/hot", summary("/repo/hot", 4, 9000)],
      ["/repo/warm", summary("/repo/warm", 1, 5000)],
      ["/repo", summary("/repo", 7, 9999)],
    ]);

    expect(orderWorktrees(list, summaries, "/repo").map((entry) => entry.branch)).toEqual([
      "main",
      "hot",
      "warm",
      "quiet",
    ]);
  });

  test("sorts worktrees with no activity by path, so the quiet tail is stable", () => {
    const list = [worktree("/repo/b", "b"), worktree("/repo/a", "a")];
    expect(orderWorktrees(list, new Map(), "/nowhere").map((entry) => entry.branch)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("worktrees in a fixture repo", () => {
  test("lists the main and a linked worktree with their branches", async () => {
    const repoRoot = createFixtureRepo("stet-git-worktree-", { "a.ts": "const a = 1\n" });
    try {
      runGit(repoRoot, ["worktree", "add", "-b", "side", join(repoRoot, ".wt")]);
      const worktrees = await loadWorktrees(repoRoot);
      expect(worktrees).toHaveLength(2);
      expect(worktrees[1]).toMatchObject({ bare: false, branch: "side", detached: false });
      expect(worktrees[1]?.path.endsWith(".wt")).toBe(true);
      expect(worktrees[0]?.branch).toBeDefined();
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test("summarizes each worktree's own changed set, and skips one whose directory is gone", async () => {
    const repoRoot = createFixtureRepo("stet-worktree-summaries-", { "a.ts": "const a = 1\n" });
    // Outside the repo, so the main worktree stays genuinely clean: a nested worktree is itself an
    // Untracked entry in its parent, which would count as a change here (real setups gitignore it).
    const linkedRoot = `${repoRoot}-linked`;
    try {
      runGit(repoRoot, ["worktree", "add", "-b", "side", linkedRoot]);
      writeFileSync(join(linkedRoot, "one.ts"), "const one = 1\n");
      writeFileSync(join(linkedRoot, "two.ts"), "const two = 2\n");

      const summaries = await loadWorktreeSummaries([
        repoRoot,
        linkedRoot,
        `${repoRoot}-does-not-exist`,
      ]);

      expect(summaries).toHaveLength(2);
      expect(summaries.find((entry) => entry.path === repoRoot)).toMatchObject({
        changed: 0,
        lastActivityAt: undefined,
      });
      const linked = summaries.find((entry) => entry.path === linkedRoot);
      expect(linked?.changed).toBe(2);
      expect(linked?.lastActivityAt).toBeGreaterThan(0);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
      rmSync(linkedRoot, { force: true, recursive: true });
    }
  });
});
