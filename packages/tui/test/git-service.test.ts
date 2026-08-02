import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect, Layer } from "effect";

import { emptyTreeForFormat } from "@/git/repo";
import { Git, GitLive } from "@/git/service";
import { ProcessLive } from "@/process";
import { stripGitEnv } from "@/utils/env";

import { createFixtureRepo, runGit } from "./helpers";

const allScope = { kind: "all", ref: "HEAD" } as const;

function revParse(repo: string, ref: string) {
  return execFileSync("git", ["rev-parse", ref], {
    cwd: repo,
    encoding: "utf8",
    env: stripGitEnv(process.env),
  }).trim();
}

test("Git.loadModel reports a modified file with churn counts", async () => {
  const repo = createFixtureRepo("git-service-modified-", { "a.txt": "one\n" });
  try {
    writeFileSync(join(repo, "a.txt"), "one\ntwo\n");

    const model = await Effect.runPromise(
      Git.pipe(
        Effect.flatMap((git) => git.loadModel(repo, allScope)),
        Effect.provide(GitLive.pipe(Layer.provide(ProcessLive))),
      ),
    );

    const file = model.changed.find((entry) => entry.path === "a.txt");
    expect(file?.kind).toBe("modified");
    expect(file?.additions).toBe(1);
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});

test("Git.changedFiles includes an untracked file", async () => {
  const repo = createFixtureRepo("git-service-untracked-", { "tracked.txt": "x\n" });
  try {
    writeFileSync(join(repo, "new.txt"), "fresh\n");

    const result = await Effect.runPromise(
      Git.pipe(
        Effect.flatMap((git) => git.changedFiles(repo, allScope)),
        Effect.provide(GitLive.pipe(Layer.provide(ProcessLive))),
      ),
    );

    expect(result.changed.find((entry) => entry.path === "new.txt")?.kind).toBe("untracked");
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});

// The caller substitutes this repository's empty tree; the service only reports that there is no
// Parent, since only the caller knows which empty tree this repository uses.
test("Git.parentRef reports no parent on a root commit", async () => {
  const repo = createFixtureRepo("git-service-rootcommit-", { "a.txt": "one\n" });
  try {
    const parent = await Effect.runPromise(
      Git.pipe(
        Effect.flatMap((git) => git.parentRef(repo)),
        Effect.provide(GitLive.pipe(Layer.provide(ProcessLive))),
      ),
    );

    expect(parent).toBeUndefined();
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});

test("Git.parentRef returns the prior commit's SHA when one exists", async () => {
  const repo = createFixtureRepo("git-service-parent-", { "a.txt": "one\n" });
  try {
    const first = revParse(repo, "HEAD");
    writeFileSync(join(repo, "a.txt"), "one\ntwo\n");
    runGit(repo, ["commit", "-am", "second"]);

    const parent = await Effect.runPromise(
      Git.pipe(
        Effect.flatMap((git) => git.parentRef(repo)),
        Effect.provide(GitLive.pipe(Layer.provide(ProcessLive))),
      ),
    );

    expect(parent).toBe(first);
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});

test("Git.headRef returns the current HEAD SHA", async () => {
  const repo = createFixtureRepo("git-service-headref-", { "a.txt": "one\n" });
  try {
    const head = revParse(repo, "HEAD");

    const resolved = await Effect.runPromise(
      Git.pipe(
        Effect.flatMap((git) => git.headRef(repo)),
        Effect.provide(GitLive.pipe(Layer.provide(ProcessLive))),
      ),
    );

    expect(resolved).toBe(head);
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});

// The signal selectScope relies on to block last-commit when HEAD is unborn: a real repo always
// Resolves HEAD to a sha, so `undefined` means "no commits yet" and nothing else.
test("Git.headRef reports no HEAD when HEAD is unborn", async () => {
  const repo = mkdtempSync(join(tmpdir(), "git-service-unborn-"));
  runGit(repo, ["init"]);
  try {
    const resolved = await Effect.runPromise(
      Git.pipe(
        Effect.flatMap((git) => git.headRef(repo)),
        Effect.provide(GitLive.pipe(Layer.provide(ProcessLive))),
      ),
    );

    expect(resolved).toBeUndefined();
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});

// The unborn base in practice: with no HEAD to diff against, the empty tree is the endpoint, and a
// Repository with no commits reads as an all-added tree instead of failing the load.
test("Git.changedFiles against the empty tree lists a commitless repo's files", async () => {
  const repo = mkdtempSync(join(tmpdir(), "git-service-unborn-changed-"));
  runGit(repo, ["init"]);
  try {
    writeFileSync(join(repo, "staged.txt"), "one\n");
    writeFileSync(join(repo, "loose.txt"), "two\n");
    runGit(repo, ["add", "staged.txt"]);

    const result = await Effect.runPromise(
      Git.pipe(
        Effect.flatMap((git) =>
          git.changedFiles(repo, { kind: "all", ref: emptyTreeForFormat("sha1") }),
        ),
        Effect.provide(GitLive.pipe(Layer.provide(ProcessLive))),
      ),
    );

    expect(result.changed.find((entry) => entry.path === "staged.txt")?.kind).toBe("added");
    expect(result.changed.find((entry) => entry.path === "loose.txt")?.kind).toBe("untracked");
    expect(result.branch).not.toBeUndefined();
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});

test("Git.loadModel against the empty tree lists a commitless repo's tracked files", async () => {
  const repo = mkdtempSync(join(tmpdir(), "git-service-unborn-model-"));
  runGit(repo, ["init"]);
  try {
    writeFileSync(join(repo, "staged.txt"), "one\n");
    runGit(repo, ["add", "staged.txt"]);

    const model = await Effect.runPromise(
      Git.pipe(
        Effect.flatMap((git) =>
          git.loadModel(repo, { kind: "all", ref: emptyTreeForFormat("sha1") }),
        ),
        Effect.provide(GitLive.pipe(Layer.provide(ProcessLive))),
      ),
    );

    expect(model.repoFiles.map((file) => file.path)).toContain("staged.txt");
    expect(model.changed.find((entry) => entry.path === "staged.txt")?.kind).toBe("added");
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});

test("Git.repoContext resolves the repo root, main worktree, and empty tree", async () => {
  const repo = createFixtureRepo("git-service-context-", { "a.txt": "one\n" });
  try {
    const context = await Effect.runPromise(
      Git.pipe(
        Effect.flatMap((git) => git.repoContext(repo)),
        Effect.provide(GitLive.pipe(Layer.provide(ProcessLive))),
      ),
    );

    expect(context).toEqual({
      emptyTree: emptyTreeForFormat("sha1"),
      mainWorktreePath: repo,
      repoRoot: repo,
    });
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});

test("Git.repoContext names the directory when it is not a repository", async () => {
  const dir = mkdtempSync(join(tmpdir(), "git-service-norepo-"));
  try {
    const failure = await Effect.runPromise(
      Git.pipe(
        Effect.flatMap((git) => git.repoContext(dir)),
        Effect.flip,
        Effect.provide(GitLive.pipe(Layer.provide(ProcessLive))),
      ),
    );

    expect(failure.message).toBe(`not a git repository: ${dir}`);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("Git.repoContext reports a bare repository as having no working tree", async () => {
  const dir = mkdtempSync(join(tmpdir(), "git-service-bare-"));
  runGit(dir, ["init", "--bare"]);
  try {
    const failure = await Effect.runPromise(
      Git.pipe(
        Effect.flatMap((git) => git.repoContext(dir)),
        Effect.flip,
        Effect.provide(GitLive.pipe(Layer.provide(ProcessLive))),
      ),
    );

    expect(failure.message).toBe(`no git working tree at ${dir}`);
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

// What `git diff` will and will not take as a side. A blob resolves as an object but has no tree,
// So `rev-parse --verify` alone would call it usable and leave the diff to fail with a usage block;
// A revision range and a reflog index git cannot evaluate are the cases that must not be rejected
// Or raised, since this question only ever explains a diff that already failed.
test("Git.refIsDiffable separates the sides git diff can take", async () => {
  const repo = createFixtureRepo("git-service-diffable-", { "a.txt": "one\n" });
  try {
    const blob = execFileSync("git", ["rev-parse", "HEAD:a.txt"], {
      cwd: repo,
      encoding: "utf8",
      env: stripGitEnv(process.env),
    }).trim();
    runGit(repo, ["branch", "other"]);

    const answers = await Effect.runPromise(
      Git.pipe(
        Effect.flatMap((git) =>
          Effect.all(
            ["HEAD", "other", "other...HEAD", "nosuchref", blob, "HEAD@{500}"].map((ref) =>
              git.refIsDiffable(repo, ref),
            ),
          ),
        ),
        Effect.provide(GitLive.pipe(Layer.provide(ProcessLive))),
      ),
    );

    // A range is a whole `git diff` takes and `rev-parse` cannot resolve, so it is exempt rather
    // Than rejected: unsure never becomes an accusation.
    expect(answers.slice(0, 3)).toEqual([true, true, true]);
    // A blob resolves as an object but has no tree, and a reflog index past the end is a revision
    // Git refuses to evaluate; `git diff` rejects both (verified: exit 129 and 128), so naming them
    // Is right where quoting stet's own invocation would not be.
    expect(answers.slice(3)).toEqual([false, false, false]);
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});

// GIT_DIR overrides cwd-based repo discovery for any git invocation that inherits it, even
// One passed an explicit, correct cwd. A git hook (e.g. lefthook's pre-push) sets GIT_DIR in
// Its own environment so its own git commands target the right repo; a child process that
// Inherits that environment (any execFileSync without an explicit env) has its own, unrelated
// Git commands silently redirected to that same repo instead. This is what let dozens of
// Fixture-repo commits land on a real branch during a real `git push` (see PR description).
test("an inherited GIT_DIR silently redirects an unsanitized git invocation", () => {
  const decoy = createFixtureRepo("git-env-decoy-", { "a.txt": "one\n" });
  const other = mkdtempSync(join(tmpdir(), "git-env-hostile-"));
  const before = revParse(decoy, "HEAD");
  const hostileEnv = { ...process.env, GIT_DIR: join(decoy, ".git") };
  const gitConfig = ["-c", "user.name=Stet Test", "-c", "user.email=stet-test@example.com"];

  try {
    writeFileSync(join(other, "b.txt"), "two\n");
    execFileSync("git", [...gitConfig, "init"], { cwd: other, env: hostileEnv, stdio: "ignore" });
    execFileSync("git", ["add", "."], { cwd: other, env: hostileEnv, stdio: "ignore" });
    execFileSync("git", [...gitConfig, "commit", "-m", "leak"], {
      cwd: other,
      env: hostileEnv,
      stdio: "ignore",
    });

    // Proves the vulnerability is real: cwd pointed at `other` the whole time, yet the
    // Commit landed in `decoy` because GIT_DIR was inherited unsanitized.
    expect(revParse(decoy, "HEAD")).not.toBe(before);
  } finally {
    rmSync(decoy, { force: true, recursive: true });
    rmSync(other, { force: true, recursive: true });
  }
});

test("stripGitEnv neutralizes that same inherited GIT_DIR", () => {
  const decoy = createFixtureRepo("git-env-decoy2-", { "a.txt": "one\n" });
  const other = mkdtempSync(join(tmpdir(), "git-env-sanitized-"));
  const before = revParse(decoy, "HEAD");
  const hostileEnv = { ...process.env, GIT_DIR: join(decoy, ".git") };
  const gitConfig = ["-c", "user.name=Stet Test", "-c", "user.email=stet-test@example.com"];
  // The exact pattern runGit uses: an explicit, freshly-computed env replaces whatever the
  // Process inherited, rather than relying on execFileSync's default env passthrough.
  const opts = { cwd: other, env: stripGitEnv(hostileEnv), stdio: "ignore" as const };

  try {
    writeFileSync(join(other, "b.txt"), "two\n");
    execFileSync("git", [...gitConfig, "init"], opts);
    execFileSync("git", ["add", "."], opts);
    execFileSync("git", [...gitConfig, "commit", "-m", "child"], opts);

    expect(revParse(decoy, "HEAD")).toBe(before);
    expect(revParse(other, "HEAD")).not.toBe("");
  } finally {
    rmSync(decoy, { force: true, recursive: true });
    rmSync(other, { force: true, recursive: true });
  }
});
