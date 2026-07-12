import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { Effect, Layer } from "effect";

import { blameArgs, parseBlamePorcelain } from "@/git/blame";
import type { PatchSide } from "@/git/file-patch";
import { Git, GitLive } from "@/git/service";
import { ProcessLive } from "@/process";

import { createFixtureRepo, runGit } from "./helpers";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const ZERO = "0".repeat(40);

const blame = (repoRoot: string, path: string, side?: PatchSide) =>
  Effect.runPromise(
    Git.pipe(
      Effect.flatMap((git) => git.blame(repoRoot, path, side)),
      Effect.provide(GitLive.pipe(Layer.provide(ProcessLive))),
    ),
  );

describe("blameArgs", () => {
  test("requests porcelain blame of the given path", () => {
    const args = blameArgs("src/a.ts");
    expect(args).toEqual(["git", "blame", "--porcelain", "--", "src/a.ts"]);
  });

  test("threads an optional revision before the path separator", () => {
    expect(blameArgs("src/a.ts", "HEAD~1")).toEqual([
      "git",
      "blame",
      "--porcelain",
      "HEAD~1",
      "--",
      "src/a.ts",
    ]);
  });
});

describe("parseBlamePorcelain", () => {
  test("attributes each line to its commit's author, time, and summary", () => {
    const stream = [
      `${SHA_A} 1 1 2`,
      "author Jane Doe",
      "author-mail <jane@example.com>",
      "author-time 1700000000",
      "author-tz +0000",
      "summary add greeting",
      "filename hello.txt",
      "\tconst a = 1;",
      `${SHA_A} 2 2`,
      "\tconst b = 2;",
      "",
    ].join("\n");

    expect(parseBlamePorcelain(stream)).toEqual([
      {
        author: "Jane Doe",
        authorTime: 1_700_000_000,
        line: 1,
        sha: SHA_A,
        summary: "add greeting",
        uncommitted: false,
      },
      {
        author: "Jane Doe",
        authorTime: 1_700_000_000,
        line: 2,
        sha: SHA_A,
        summary: "add greeting",
        uncommitted: false,
      },
    ]);
  });

  test("flags the all-zero sha as an uncommitted working-tree line", () => {
    const stream = [
      `${ZERO} 3 3 1`,
      "author Not Committed Yet",
      "author-time 1700000100",
      "summary Version of hello.txt",
      `previous ${SHA_A} hello.txt`,
      "filename hello.txt",
      "\tconst c = 3;",
      "",
    ].join("\n");

    const [line] = parseBlamePorcelain(stream);
    expect(line?.uncommitted).toBe(true);
    expect(line?.line).toBe(3);
  });

  test("resolves a repeated sha against its earlier header block", () => {
    const stream = [
      `${SHA_A} 1 1 1`,
      "author Jane Doe",
      "author-time 1700000000",
      "summary first",
      "filename f.txt",
      "\tline one",
      `${SHA_B} 2 2 1`,
      "author John Roe",
      "author-time 1700000500",
      "summary second",
      "filename f.txt",
      "\tline two",
      `${SHA_A} 3 3`,
      "\tline three",
      "",
    ].join("\n");

    const lines = parseBlamePorcelain(stream);
    expect(lines.map((entry) => [entry.line, entry.author, entry.summary])).toEqual([
      [1, "Jane Doe", "first"],
      [2, "John Roe", "second"],
      [3, "Jane Doe", "first"],
    ]);
  });

  test("parses 64-char SHA-256 headers and flags an all-zero sha as uncommitted", () => {
    const sha256 = "a".repeat(64);
    const stream = [
      `${sha256} 1 1 1`,
      "author Jane Doe",
      "author-time 1700000000",
      "summary commit",
      "filename f.txt",
      "\tline one",
      `${"0".repeat(64)} 2 2 1`,
      "author Not Committed Yet",
      "author-time 1700000100",
      "summary wip",
      "\tline two",
      "",
    ].join("\n");

    const lines = parseBlamePorcelain(stream);
    expect(lines.map((entry) => [entry.sha, entry.uncommitted])).toEqual([
      [sha256, false],
      ["0".repeat(64), true],
    ]);
  });
});

describe("Git.blame", () => {
  test("attributes committed lines and flags an uncommitted edit", async () => {
    const repo = createFixtureRepo("git-blame-", { "a.txt": "one\ntwo\n" });

    const committed = await blame(repo, "a.txt");
    expect(committed).toHaveLength(2);
    expect(committed[0]?.author).toBe("Stet Test");
    expect(committed[0]?.uncommitted).toBe(false);

    writeFileSync(join(repo, "a.txt"), "one\ntwo\nthree\n");
    const edited = await blame(repo, "a.txt");
    expect(edited).toHaveLength(3);
    expect(edited[2]?.uncommitted).toBe(true);
  });

  test("returns an empty list for an untracked path", async () => {
    const repo = createFixtureRepo("git-blame-untracked-", { "a.txt": "one\n" });
    writeFileSync(join(repo, "new.txt"), "brand new\n");
    expect(await blame(repo, "new.txt")).toEqual([]);
  });

  test("blames a git-revision side, not the working tree", async () => {
    const repo = createFixtureRepo("git-blame-rev-", { "a.txt": "one\ntwo\n" });
    writeFileSync(join(repo, "a.txt"), "one\ntwo\nthree\n");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "third"]);
    writeFileSync(join(repo, "a.txt"), "one\ntwo\nthree\nfour\n");

    // The working tree has four lines, the last still uncommitted.
    const worktree = await blame(repo, "a.txt");
    expect(worktree).toHaveLength(4);
    expect(worktree[3]?.uncommitted).toBe(true);

    // At the first commit the file had two lines, all committed.
    const atFirst = await blame(repo, "a.txt", { kind: "git", spec: "HEAD~1:a.txt" });
    expect(atFirst).toHaveLength(2);
    expect(atFirst.some((line) => line.uncommitted)).toBe(false);
  });

  test("blames the index side (staged content) via --contents, ignoring unstaged edits", async () => {
    const repo = createFixtureRepo("git-blame-index-", { "a.txt": "one\n" });
    writeFileSync(join(repo, "a.txt"), "one\ntwo\n");
    runGit(repo, ["add", "."]); // Index now has two lines
    writeFileSync(join(repo, "a.txt"), "one\ntwo\nthree\n"); // Unstaged third line on top

    // The index (`:a.txt`) has two lines; the second is staged-but-not-committed.
    const index = await blame(repo, "a.txt", { kind: "git", spec: ":a.txt" });
    expect(index).toHaveLength(2);
    expect(index[0]?.uncommitted).toBe(false);
    expect(index[1]?.uncommitted).toBe(true);
  });
});
