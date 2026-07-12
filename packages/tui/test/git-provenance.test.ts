import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { Effect, Layer } from "effect";

import type { BlameLine } from "@/git/blame";
import {
  classifyProvenance,
  commitsSinceArgs,
  defaultBranchArgs,
  firstCommitArgs,
  mergeBaseArgs,
  parseFirstCommit,
  parseRevList,
} from "@/git/provenance";
import type { ProvenanceContext } from "@/git/provenance";
import { Git, GitLive } from "@/git/service";
import { ProcessLive } from "@/process";

import { createFixtureRepo, runGit } from "./helpers";

const line = (overrides: Partial<BlameLine>): BlameLine => ({
  author: "Jane Doe",
  authorTime: 1_700_000_000,
  line: 1,
  sha: "a".repeat(40),
  summary: "commit",
  uncommitted: false,
  ...overrides,
});

const ctx = (overrides: Partial<ProvenanceContext>): ProvenanceContext => ({
  branchShas: new Set(),
  fileFirstSha: undefined,
  sessionShas: new Set(),
  ...overrides,
});

const runGitEffect = <A>(effect: Effect.Effect<A, unknown, Git>) =>
  Effect.runPromise(effect.pipe(Effect.provide(GitLive.pipe(Layer.provide(ProcessLive)))));

const headRef = (repoRoot: string) =>
  runGitEffect(Git.pipe(Effect.flatMap((git) => git.headRef(repoRoot))));

const commitsSince = (repoRoot: string, base: string) =>
  runGitEffect(Git.pipe(Effect.flatMap((git) => git.commitsSince(repoRoot, base))));

const fileFirstCommit = (repoRoot: string, path: string) =>
  runGitEffect(Git.pipe(Effect.flatMap((git) => git.fileFirstCommit(repoRoot, path))));

const branchBase = (repoRoot: string) =>
  runGitEffect(Git.pipe(Effect.flatMap((git) => git.branchBase(repoRoot))));

describe("classifyProvenance", () => {
  test("an uncommitted line is uncommitted regardless of the sets", () => {
    expect(classifyProvenance(line({ uncommitted: true }), ctx({}))).toBe("uncommitted");
  });

  test("a commit in the session set is this session", () => {
    const sha = "c".repeat(40);
    expect(classifyProvenance(line({ sha }), ctx({ sessionShas: new Set([sha]) }))).toBe("session");
  });

  test("a commit in the branch set (but not session) is this branch", () => {
    const sha = "d".repeat(40);
    expect(classifyProvenance(line({ sha }), ctx({ branchShas: new Set([sha]) }))).toBe("branch");
  });

  test("the file's first commit is initial", () => {
    const sha = "e".repeat(40);
    expect(classifyProvenance(line({ sha }), ctx({ fileFirstSha: sha }))).toBe("initial");
  });

  test("any other committed line is changed since initial", () => {
    expect(
      classifyProvenance(line({ sha: "f".repeat(40) }), ctx({ fileFirstSha: "e".repeat(40) })),
    ).toBe("changed");
  });

  test("session wins over branch when a commit is in both", () => {
    const sha = "g".repeat(40);
    expect(
      classifyProvenance(
        line({ sha }),
        ctx({ branchShas: new Set([sha]), sessionShas: new Set([sha]) }),
      ),
    ).toBe("session");
  });

  test("a file born on the branch reads branch, not initial", () => {
    const sha = "h".repeat(40);
    expect(
      classifyProvenance(line({ sha }), ctx({ branchShas: new Set([sha]), fileFirstSha: sha })),
    ).toBe("branch");
  });
});

describe("arg builders and parsers", () => {
  test("commitsSinceArgs lists commits reachable from HEAD but not the base", () => {
    expect(commitsSinceArgs("abc123")).toEqual(["git", "rev-list", "abc123..HEAD"]);
  });

  test("firstCommitArgs asks for the file's add commit", () => {
    expect(firstCommitArgs("src/a.ts")).toEqual([
      "git",
      "log",
      "--format=%H",
      "--diff-filter=A",
      "--",
      "src/a.ts",
    ]);
  });

  test("defaultBranchArgs and mergeBaseArgs resolve the branch base", () => {
    expect(defaultBranchArgs()).toEqual([
      "git",
      "symbolic-ref",
      "--short",
      "refs/remotes/origin/HEAD",
    ]);
    expect(mergeBaseArgs("origin/main")).toEqual(["git", "merge-base", "HEAD", "origin/main"]);
  });

  test("parseRevList collects the SHAs and drops blanks", () => {
    expect(parseRevList("abc\ndef\n")).toEqual(new Set(["abc", "def"]));
    expect(parseRevList("").size).toBe(0);
  });

  test("parseFirstCommit takes the oldest (last) line, or undefined when empty", () => {
    expect(parseFirstCommit("newer\nolder\n")).toBe("older");
    expect(parseFirstCommit("")).toBeUndefined();
  });
});

describe("Git.commitsSince", () => {
  test("returns commits after the base and excludes the base itself", async () => {
    const repo = createFixtureRepo("git-since-", { "a.txt": "one\n" });
    const base = await headRef(repo);

    writeFileSync(join(repo, "a.txt"), "two\n");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "second"]);
    const head = await headRef(repo);

    const since = await commitsSince(repo, base);
    expect(since.has(head)).toBe(true);
    expect(since.has(base)).toBe(false);
  });

  test("is empty when the base is HEAD (no commits this session)", async () => {
    const repo = createFixtureRepo("git-since-none-", { "a.txt": "one\n" });
    const since = await commitsSince(repo, "HEAD");
    expect(since.size).toBe(0);
  });
});

describe("Git.fileFirstCommit", () => {
  test("returns the commit that introduced the file, not a later edit", async () => {
    const repo = createFixtureRepo("git-first-", { "a.txt": "one\n" });
    const introduced = await headRef(repo);

    writeFileSync(join(repo, "a.txt"), "one\ntwo\n");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "second"]);

    expect(await fileFirstCommit(repo, "a.txt")).toBe(introduced);
  });

  test("is undefined for a path with no history", async () => {
    const repo = createFixtureRepo("git-first-none-", { "a.txt": "one\n" });
    writeFileSync(join(repo, "new.txt"), "brand new\n");
    expect(await fileFirstCommit(repo, "new.txt")).toBeUndefined();
  });
});

describe("Git.branchBase", () => {
  test("returns the merge-base with the default branch (main fallback)", async () => {
    const repo = createFixtureRepo("git-branchbase-", { "a.txt": "one\n" });
    runGit(repo, ["branch", "-M", "main"]);
    const mainTip = await headRef(repo);

    runGit(repo, ["checkout", "-b", "feature"]);
    writeFileSync(join(repo, "a.txt"), "two\n");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "on feature"]);

    expect(await branchBase(repo)).toBe(mainTip);
  });
});
