import { describe, expect, test } from "bun:test";
import { rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  mergeWorktreeSummaries,
  orderWorktrees,
  parseCommitTimes,
  parseWorktreeList,
  parseWorktreeStatusPaths,
  summarizeWorktree,
  worktreePathTails,
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

function summary(path: string, lastActivityAt: number | undefined): WorktreeSummary {
  return { lastActivityAt, path };
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

describe("parseCommitTimes", () => {
  test("reads each sha's commit time, in milliseconds", () => {
    const times = parseCommitTimes("abc123 1783795743\ndef456 1783874190\n");
    expect(times.get("abc123")).toBe(1_783_795_743_000);
    expect(times.get("def456")).toBe(1_783_874_190_000);
  });

  test("returns nothing for empty output", () => {
    expect(parseCommitTimes("").size).toBe(0);
  });
});

describe("summarizeWorktree", () => {
  test("takes the newest mtime among the uncommitted files", () => {
    const repoRoot = createFixtureRepo("stet-worktree-summary-", { "a.ts": "const a = 1\n" });
    try {
      writeFileSync(join(repoRoot, "old.ts"), "const old = 1\n");
      writeFileSync(join(repoRoot, "new.ts"), "const fresh = 1\n");
      utimesSync(
        join(repoRoot, "old.ts"),
        new Date(2_000_000_000_000),
        new Date(2_000_000_000_000),
      );
      utimesSync(
        join(repoRoot, "new.ts"),
        new Date(2_100_000_000_000),
        new Date(2_100_000_000_000),
      );

      const result = summarizeWorktree(repoRoot, "?? old.ts\0?? new.ts\0", undefined);

      expect(result.lastActivityAt).toBe(2_100_000_000_000);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  // The bug this whole model exists to fix: edits alone go to zero the moment an agent commits,
  // Which is exactly when it was busiest. A clean worktree that was just committed to is active.
  test("stays active on a clean worktree that was just committed to", () => {
    const result = summarizeWorktree("/repo", "", 2_100_000_000_000);
    expect(result.lastActivityAt).toBe(2_100_000_000_000);
  });

  test("prefers whichever is newer, the uncommitted edit or the commit", () => {
    const repoRoot = createFixtureRepo("stet-worktree-newer-", { "a.ts": "const a = 1\n" });
    try {
      writeFileSync(join(repoRoot, "edit.ts"), "const edited = 1\n");
      utimesSync(
        join(repoRoot, "edit.ts"),
        new Date(2_000_000_000_000),
        new Date(2_000_000_000_000),
      );

      // A commit newer than the edit wins, and an older one loses to it.
      expect(summarizeWorktree(repoRoot, "?? edit.ts\0", 2_100_000_000_000).lastActivityAt).toBe(
        2_100_000_000_000,
      );
      expect(summarizeWorktree(repoRoot, "?? edit.ts\0", 1_000_000_000_000).lastActivityAt).toBe(
        2_000_000_000_000,
      );
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test("reads the reflog, so a checkout or rebase counts even with nothing uncommitted", () => {
    const repoRoot = createFixtureRepo("stet-worktree-reflog-", { "a.ts": "const a = 1\n" });
    try {
      // The fixture's own commit wrote logs/HEAD moments ago; no commit time is passed, so the
      // Reflog is the only signal left and it must still register the worktree as freshly touched.
      const result = summarizeWorktree(repoRoot, "", undefined);
      expect(result.lastActivityAt).toBeGreaterThan(Date.now() - 60_000);
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
    }
  });

  test("reports no activity when there is nothing to read at all", () => {
    expect(summarizeWorktree("/repo-does-not-exist", "", undefined)).toEqual({
      lastActivityAt: undefined,
      path: "/repo-does-not-exist",
    });
  });
});

describe("mergeWorktreeSummaries", () => {
  test("keeps the previous map when nothing moved, so an idle poll wakes nothing", () => {
    const previous = new Map([["/repo", summary("/repo", 1000)]]);
    expect(mergeWorktreeSummaries(previous, [summary("/repo", 1000)])).toBe(previous);
  });

  test("replaces the map when a worktree's activity advances", () => {
    const previous = new Map([["/repo", summary("/repo", 1000)]]);
    const merged = mergeWorktreeSummaries(previous, [summary("/repo", 2000)]);
    expect(merged).not.toBe(previous);
    expect(merged.get("/repo")?.lastActivityAt).toBe(2000);
  });

  test("replaces the map when a worktree appears", () => {
    const previous = new Map([["/repo", summary("/repo", undefined)]]);
    const merged = mergeWorktreeSummaries(previous, [
      summary("/repo", undefined),
      summary("/side", 50),
    ]);
    expect(merged).not.toBe(previous);
    expect(merged.size).toBe(2);
  });
});

describe("orderWorktrees", () => {
  test("ranks worktrees by how recently they were touched, with no pin for main", () => {
    const list = [
      worktree("/repo/quiet", "quiet"),
      worktree("/repo/hot", "hot"),
      worktree("/repo", "main"),
      worktree("/repo/warm", "warm"),
    ];
    const summaries = new Map([
      ["/repo/hot", summary("/repo/hot", 9000)],
      ["/repo/warm", summary("/repo/warm", 5000)],
      ["/repo", summary("/repo", 3000)],
    ]);

    expect(orderWorktrees(list, summaries).map((entry) => entry.branch)).toEqual([
      "hot",
      "warm",
      "main",
      "quiet",
    ]);
  });

  test("sorts worktrees with no activity by path, so the quiet tail is stable", () => {
    const list = [worktree("/repo/b", "b"), worktree("/repo/a", "a")];
    expect(orderWorktrees(list, new Map()).map((entry) => entry.branch)).toEqual(["a", "b"]);
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

  test("summarizes every worktree, and skips one whose directory is gone", async () => {
    const repoRoot = createFixtureRepo("stet-worktree-summaries-", { "a.ts": "const a = 1\n" });
    const linkedRoot = `${repoRoot}-linked`;
    try {
      runGit(repoRoot, ["worktree", "add", "-b", "side", linkedRoot]);
      writeFileSync(join(linkedRoot, "one.ts"), "const one = 1\n");

      const worktrees = await loadWorktrees(repoRoot);
      const summaries = await loadWorktreeSummaries(
        [...worktrees, worktree(`${repoRoot}-does-not-exist`, "gone")],
        repoRoot,
      );

      // The dead worktree is dropped rather than failing the batch; the live ones both report a real
      // Age, because even a clean worktree has just been committed to by the fixture.
      expect(summaries).toHaveLength(2);
      for (const entry of summaries) {
        expect(entry.lastActivityAt).toBeGreaterThan(Date.now() - 60_000);
      }
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
      rmSync(linkedRoot, { force: true, recursive: true });
    }
  });

  // The regression, end to end through the real service: an agent that commits its work leaves a
  // Clean worktree, and the old model read that as dead. It must outrank a dirty but stale one.
  test("ranks a just-committed clean worktree above a worktree with stale uncommitted edits", async () => {
    const repoRoot = createFixtureRepo("stet-worktree-rank-", { "a.ts": "const a = 1\n" });
    const staleRoot = `${repoRoot}-stale`;
    const committedRoot = `${repoRoot}-committed`;
    try {
      runGit(repoRoot, ["worktree", "add", "-b", "stale", staleRoot]);
      runGit(repoRoot, ["worktree", "add", "-b", "committed", committedRoot]);

      // A worktree left dirty a long time ago: edits, but nothing recent.
      writeFileSync(join(staleRoot, "wip.ts"), "const wip = 1\n");
      utimesSync(
        join(staleRoot, "wip.ts"),
        new Date(1_600_000_000_000),
        new Date(1_600_000_000_000),
      );

      // A worktree an agent just finished in: committed, so it holds nothing uncommitted at all.
      writeFileSync(join(committedRoot, "done.ts"), "const done = 1\n");
      runGit(committedRoot, ["add", "."]);
      runGit(committedRoot, ["commit", "-m", "agent finished"]);

      const worktrees = await loadWorktrees(repoRoot);
      const summaries = await loadWorktreeSummaries(worktrees, repoRoot);
      const byPath = new Map(summaries.map((entry) => [entry.path, entry]));
      const ordered = orderWorktrees(worktrees, byPath);

      expect(ordered[0]?.path).toBe(committedRoot);
      expect(byPath.get(staleRoot)?.lastActivityAt).toBeLessThan(
        byPath.get(committedRoot)?.lastActivityAt ?? 0,
      );
    } finally {
      rmSync(repoRoot, { force: true, recursive: true });
      rmSync(staleRoot, { force: true, recursive: true });
      rmSync(committedRoot, { force: true, recursive: true });
    }
  });
});

describe("worktreePathTails", () => {
  test("keeps only what differs when the worktrees are nested under the main one", () => {
    const tails = worktreePathTails([
      worktree("/repo", "main"),
      worktree("/repo/.claude/worktrees/fix-header", "fix/header"),
    ]);

    // The main worktree *is* the shared prefix, so it has no distinguishing path text at all.
    expect(tails.get("/repo")).toBe("");
    expect(tails.get("/repo/.claude/worktrees/fix-header")).toBe(".claude/worktrees/fix-header");
  });

  test("splits siblings on segments, so a shared parent never slices a leaf mid-name", () => {
    const tails = worktreePathTails([
      worktree("/tmp/repo", "main"),
      worktree("/tmp/repo-linked", "side"),
    ]);

    // Compared character by character the prefix would be `/tmp/repo`, leaving `` and `-linked`.
    expect(tails.get("/tmp/repo")).toBe("repo");
    expect(tails.get("/tmp/repo-linked")).toBe("repo-linked");
  });

  test("keeps the whole path when the worktrees share no directory", () => {
    const tails = worktreePathTails([worktree("/a/one", "main"), worktree("/b/two", "side")]);

    expect(tails.get("/a/one")).toBe("a/one");
    expect(tails.get("/b/two")).toBe("b/two");
  });

  test("leaves a lone worktree nothing to narrow by", () => {
    expect(worktreePathTails([worktree("/repo", "main")]).get("/repo")).toBe("");
  });

  test("returns nothing for no worktrees", () => {
    expect(worktreePathTails([]).size).toBe(0);
  });
});
