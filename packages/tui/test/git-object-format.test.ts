import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { Effect, Layer } from "effect";

import { Git, GitLive } from "@/git/service";
import { ProcessLive } from "@/process";
import { stripGitEnv } from "@/utils/env";

import { createFixtureRepo, loadFileDiff, loadModel, runGit } from "./helpers";

// A SHA-256 repository's objects are named by a different hash, so its empty tree is a different
// Object than the SHA-1 one stet used to hardcode. These exercise the paths that need a base when
// There is no commit on the other side: an unborn HEAD, and a root commit's absent parent.
//
// No git-version guard: SHA-256 landed in git 2.29 and stet's floor is already 2.31, the release
// That added the `rev-parse --path-format` the startup preflight requires.

const sha256 = { objectFormat: "sha256" };

const runGitService = <A>(effect: Effect.Effect<A, unknown, Git>) =>
  Effect.runPromise(effect.pipe(Effect.provide(GitLive.pipe(Layer.provide(ProcessLive)))));

const repoContext = (repoRoot: string) =>
  runGitService(Git.pipe(Effect.flatMap((git) => git.repoContext(repoRoot))));

// What git itself computes for this repository, so the expectation is pinned against git rather
// Than against a hash copied into the test.
function gitEmptyTree(repoRoot: string) {
  return execFileSync("git", ["hash-object", "-t", "tree", "--stdin"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: stripGitEnv(process.env),
    input: "",
  }).trim();
}

test("Git.repoContext reads a SHA-256 repository's own empty tree", async () => {
  const repo = createFixtureRepo("git-sha256-context-", { "a.txt": "one\n" }, sha256);

  const context = await repoContext(repo);

  expect(context.emptyTree).toBe(gitEmptyTree(repo));
  expect(context.emptyTree).not.toBe("4b825dc642cb6eb9a060e54bf8d69288fbee4904");
});

// #349: against the hardcoded SHA-1 empty tree this load died with
// `fatal: ambiguous argument '4b825dc...': unknown revision or path not in the working tree`.
test("a commitless SHA-256 repository loads against its empty tree", async () => {
  const repo = createFixtureRepo(
    "git-sha256-unborn-",
    { "loose.txt": "two\n", "staged.txt": "one\n" },
    { ...sha256, commit: false },
  );
  runGit(repo, ["add", "staged.txt"]);

  const { emptyTree } = await repoContext(repo);
  const model = await loadModel(repo, { kind: "all", ref: emptyTree });

  expect(model.changed.find((entry) => entry.path === "staged.txt")?.kind).toBe("added");
  expect(model.changed.find((entry) => entry.path === "loose.txt")?.kind).toBe("untracked");
  expect(model.repoFiles.map((file) => file.path)).toContain("staged.txt");
});

test("a commitless SHA-256 repository with no files loads to an empty changed set", async () => {
  const repo = createFixtureRepo("git-sha256-empty-", {}, { ...sha256, commit: false });

  const { emptyTree } = await repoContext(repo);
  const model = await loadModel(repo, { kind: "all", ref: emptyTree });

  expect(model.changed).toEqual([]);
  expect(model.repoFiles).toEqual([]);
});

test("a SHA-256 root commit reports no parent and diffs against the empty tree", async () => {
  const repo = createFixtureRepo("git-sha256-root-", { "a.txt": "one\n" }, sha256);

  const parent = await runGitService(Git.pipe(Effect.flatMap((git) => git.parentRef(repo))));
  expect(parent).toBeUndefined();

  // What `selectScope` and `selectCommit` build once the parent comes back absent.
  const { emptyTree } = await repoContext(repo);
  const scope = { headRef: "HEAD", kind: "last-commit", ref: parent ?? emptyTree } as const;
  const model = await loadModel(repo, scope);

  const added = model.changedByPath.get("a.txt");
  if (added === undefined) {
    throw new Error("a.txt missing from the root commit's model");
  }
  expect(added.kind).toBe("added");
  expect(await loadFileDiff(repo, scope, added)).toContain("+one");
});

// The empty tree is resolved once at startup and never again, which is only sound because every
// Linked worktree reads the same object database.
test("a linked worktree of a SHA-256 repository reports the same empty tree", async () => {
  const repo = createFixtureRepo("git-sha256-worktree-", { "a.txt": "one\n" }, sha256);
  const linked = join(repo, "linked");
  runGit(repo, ["worktree", "add", "-b", "feature", linked]);

  const main = await repoContext(repo);
  const worktree = await repoContext(linked);

  expect(worktree.emptyTree).toBe(main.emptyTree);
});
