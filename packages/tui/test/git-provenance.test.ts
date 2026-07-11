import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { Effect, Layer } from "effect";

import type { BlameLine } from "@/git/blame";
import { classifyProvenance, parseRevList, sessionCommitsArgs } from "@/git/provenance";
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

const runGitEffect = <A>(effect: Effect.Effect<A, unknown, Git>) =>
  Effect.runPromise(effect.pipe(Effect.provide(GitLive.pipe(Layer.provide(ProcessLive)))));

const headRef = (repoRoot: string) =>
  runGitEffect(Git.pipe(Effect.flatMap((git) => git.headRef(repoRoot))));

const commitsSince = (repoRoot: string, base: string) =>
  runGitEffect(Git.pipe(Effect.flatMap((git) => git.commitsSince(repoRoot, base))));

describe("classifyProvenance", () => {
  test("an uncommitted line is uncommitted regardless of the session set", () => {
    expect(classifyProvenance(line({ uncommitted: true }), new Set())).toBe("uncommitted");
  });

  test("a commit in the session set is this session", () => {
    expect(classifyProvenance(line({ sha: "c".repeat(40) }), new Set(["c".repeat(40)]))).toBe(
      "session",
    );
  });

  test("a commit outside the session set is earlier", () => {
    expect(classifyProvenance(line({ sha: "d".repeat(40) }), new Set(["c".repeat(40)]))).toBe(
      "earlier",
    );
  });
});

describe("sessionCommitsArgs", () => {
  test("lists commits reachable from HEAD but not the base", () => {
    expect(sessionCommitsArgs("abc123")).toEqual(["git", "rev-list", "abc123..HEAD"]);
  });
});

describe("parseRevList", () => {
  test("collects the SHAs and drops blank lines", () => {
    expect(parseRevList("abc\ndef\n")).toEqual(new Set(["abc", "def"]));
    expect(parseRevList("").size).toBe(0);
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
