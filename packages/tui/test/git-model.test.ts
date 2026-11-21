import { describe, expect, test } from "bun:test";
import { renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { renderDiff } from "@/diff/engine";
import type { DiffInput } from "@/git/file-patch";
import {
  changedPathsDiffer,
  diffArgs,
  mergeChanged,
  nameStatusArgs,
  numstatArgs,
  parseBranch,
  parseNameStatus,
  parseNumstat,
  parsePorcelainStatus,
  parseUntrackedFiles,
  untrackedDiffArgs,
} from "@/git/model";
import type { ChangedFile, GitModel } from "@/git/model";
import { emptyTreeForFormat } from "@/git/repo";

import {
  createFixtureRepo,
  loadFileDiff,
  loadModel,
  loadRecentCommits,
  runGit,
} from "../test/helpers";

/** A rendered diff's changed lines, `+`/`-` prefixed the way a patch spells them. */
const changedLines = async (input: DiffInput) => {
  const { navigable } = await renderDiff({
    full: true,
    maxLines: 4000,
    ...input,
  });

  return navigable
    .values()
    .filter((line) => line.type !== "context")
    .map((line) => `${line.type === "add" ? "+" : "-"}${line.content}`)
    .toArray();
};

const file = (
  filePath: string,
  overrides: Partial<ChangedFile> = {}
): ChangedFile => ({
  additions: 1,
  binary: false,
  deletions: 0,
  kind: "modified",
  mtimeMs: 0,
  path: filePath,
  stage: "unstaged",
  warnings: [],
  ...overrides,
});

const model = (
  changed: ChangedFile[],
  repoFilesKey = "key",
  scopeKey = "all:HEAD"
): GitModel => ({
  branch: undefined,
  changed,
  changedByPath: new Map(changed.map((entry) => [entry.path, entry])),
  repoFiles: changed.map((entry) => ({
    path: entry.path,
    symlink: false,
    tracked: true,
  })),
  repoFilesKey,
  repoRoot: "/repo",
  scopeKey,
});

// Every diff invocation pins canonical a//b/ prefixes and disables external diff
// Drivers, so user gitconfig can't corrupt the patch text the viewer parses.
const head = [
  "git",
  "diff",
  "--no-ext-diff",
  "--src-prefix=a/",
  "--dst-prefix=b/",
];

describe("scope arguments", () => {
  test("all compares the worktree against the ref", () => {
    expect(diffArgs({ kind: "all", ref: "main" })).toEqual([...head, "main"]);
    expect(numstatArgs({ kind: "all", ref: "main" })).toEqual([
      ...head,
      "main",
      "--numstat",
      "-z",
    ]);
    expect(nameStatusArgs({ kind: "all", ref: "main" })).toEqual([
      ...head,
      "main",
      "--name-status",
      "-z",
    ]);
  });

  test("staged compares the index against the ref", () => {
    expect(diffArgs({ kind: "staged", ref: "HEAD" })).toEqual([
      ...head,
      "--cached",
      "HEAD",
    ]);
    expect(numstatArgs({ kind: "staged", ref: "HEAD" })).toEqual([
      ...head,
      "--cached",
      "HEAD",
      "--numstat",
      "-z",
    ]);
  });

  test("unstaged compares the worktree against the index and ignores the ref", () => {
    expect(diffArgs({ kind: "unstaged", ref: "main" })).toEqual([...head]);
    expect(numstatArgs({ kind: "unstaged", ref: "main" })).toEqual([
      ...head,
      "--numstat",
      "-z",
    ]);
    expect(nameStatusArgs({ kind: "unstaged", ref: "main" })).toEqual([
      ...head,
      "--name-status",
      "-z",
    ]);
  });

  test("session compares the worktree against the pinned base ref, like all", () => {
    expect(diffArgs({ kind: "session", ref: "abc123" })).toEqual([
      ...head,
      "abc123",
    ]);
    expect(numstatArgs({ kind: "session", ref: "abc123" })).toEqual([
      ...head,
      "abc123",
      "--numstat",
      "-z",
    ]);
  });

  test("last-commit diffs the resolved parent against HEAD", () => {
    expect(
      diffArgs({ headRef: "HEAD", kind: "last-commit", ref: "parentsha" })
    ).toEqual([...head, "parentsha", "HEAD"]);
    expect(
      nameStatusArgs({ headRef: "HEAD", kind: "last-commit", ref: "parentsha" })
    ).toEqual([...head, "parentsha", "HEAD", "--name-status", "-z"]);
  });

  test("last-commit falls back to the empty tree on a root commit", () => {
    const emptyTree = emptyTreeForFormat("sha1");
    expect(
      diffArgs({ headRef: "HEAD", kind: "last-commit", ref: emptyTree })
    ).toEqual([...head, emptyTree, "HEAD"]);
  });

  test("a stepped commit diffs its parent against the commit sha", () => {
    expect(
      diffArgs({ headRef: "abcsha", kind: "commit", ref: "parentsha" })
    ).toEqual([...head, "parentsha", "abcsha"]);
  });

  test("untracked files diff against /dev/null with the same canonical prefixes", () => {
    expect(untrackedDiffArgs("src/new.ts")).toEqual([
      ...head,
      "--no-index",
      "--",
      "/dev/null",
      "src/new.ts",
    ]);
  });
});

describe("parseUntrackedFiles", () => {
  test("parses nul-delimited untracked files without directory placeholders", () => {
    expect(parseUntrackedFiles("src/App.tsx\0src/git.ts\0")).toEqual([
      { kind: "untracked", path: "src/App.tsx" },
      { kind: "untracked", path: "src/git.ts" },
    ]);
  });
});

describe("parseNumstat", () => {
  test("parses nul-delimited text and binary churn, keeping unicode paths literal", () => {
    expect(parseNumstat("10\t2\tsrc/café.ts\0-\t-\timage.png\0")).toEqual([
      { additions: 10, binary: false, deletions: 2, path: "src/café.ts" },
      { additions: 0, binary: true, deletions: 0, path: "image.png" },
    ]);
  });

  test("parses rename records whose paths follow as separate fields", () => {
    expect(parseNumstat("1\t1\t\0src/old.ts\0src/new.ts\0")).toEqual([
      { additions: 1, binary: false, deletions: 1, path: "src/new.ts" },
    ]);
  });

  test("keeps paths that contain tabs intact", () => {
    expect(parseNumstat("1\t0\tweird\tname.ts\0")).toEqual([
      { additions: 1, binary: false, deletions: 0, path: "weird\tname.ts" },
    ]);
  });

  test("does not mistake a path ending in a tab for a rename record", () => {
    expect(parseNumstat("1\t0\ttrailing\t\0")).toEqual([
      { additions: 1, binary: false, deletions: 0, path: "trailing\t" },
    ]);
  });
});

describe("parseNameStatus", () => {
  test("parses nul-delimited diff status", () => {
    expect(
      parseNameStatus(
        "M\0src/a.ts\0A\0src/b.ts\0D\0src/c.ts\0R100\0src/d.ts\0src/e.ts\0"
      )
    ).toEqual([
      { kind: "modified", path: "src/a.ts" },
      { kind: "added", path: "src/b.ts" },
      { kind: "deleted", path: "src/c.ts" },
      { kind: "renamed", oldPath: "src/d.ts", path: "src/e.ts" },
    ]);
  });

  test("treats a copy as an addition of the destination", () => {
    expect(parseNameStatus("C075\0src/a.ts\0src/copy.ts\0")).toEqual([
      { kind: "added", path: "src/copy.ts" },
    ]);
  });
});

describe("parsePorcelainStatus", () => {
  test("derives staged, unstaged, mixed, and untracked", () => {
    const stages = parsePorcelainStatus(
      "M  staged.ts\0 M unstaged.ts\0MM mixed.ts\0?? new.ts\0"
    );

    expect(stages.get("staged.ts")).toBe("staged");
    expect(stages.get("unstaged.ts")).toBe("unstaged");
    expect(stages.get("mixed.ts")).toBe("mixed");
    expect(stages.get("new.ts")).toBe("untracked");
  });

  test("maps both rename paths and consumes the original token", () => {
    const stages = parsePorcelainStatus("R  new.ts\0old.ts\0 M after.ts\0");
    expect(stages.get("new.ts")).toBe("staged");
    expect(stages.get("old.ts")).toBe("staged");
    expect(stages.get("after.ts")).toBe("unstaged");
  });

  test("ignores the `-b` branch header", () => {
    const stages = parsePorcelainStatus(
      "## main...origin/main\0 M edited.ts\0"
    );

    expect(stages.get("edited.ts")).toBe("unstaged");
    expect(stages.has("main...origin/main")).toBe(false);
  });
});

describe("parseBranch", () => {
  test("reads the branch from the header", () => {
    expect(parseBranch("## main\0 M edited.ts\0")).toBe("main");
  });

  test("strips the upstream and ahead/behind tail", () => {
    expect(parseBranch("## feat/x...origin/feat/x [ahead 1, behind 2]\0")).toBe(
      "feat/x"
    );
  });

  test("names an unborn branch before its first commit", () => {
    expect(parseBranch("## No commits yet on main\0")).toBe("main");
  });

  test("returns undefined on a detached HEAD", () => {
    expect(parseBranch("## HEAD (no branch)\0")).toBeUndefined();
  });

  test("returns undefined when there is no branch header", () => {
    expect(parseBranch(" M edited.ts\0")).toBeUndefined();
    expect(parseBranch("")).toBeUndefined();
  });
});

describe("loadModel in a fixture repo", () => {
  test("reads a dangling untracked symlink as its one-line target path", async () => {
    const repoRoot = createFixtureRepo("stet-git-symlink-", {
      "a.ts": "const a = 1\n",
    });

    symlinkSync("/nonexistent-target", path.join(repoRoot, "broken-link"));
    const loaded = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    // Git stores the link's target path as its content, so it counts as 1 addition
    expect(loaded.changedByPath.get("broken-link")).toMatchObject({
      additions: 1,
      binary: false,
      kind: "untracked",
    });
    expect(
      loaded.repoFiles.find((repoFile) => repoFile.path === "broken-link")
    ).toMatchObject({
      symlink: true,
      tracked: false,
    });
  });

  test("flags a tracked symlink from its git mode", async () => {
    const repoRoot = createFixtureRepo("stet-git-tracked-symlink-", {
      "target.ts": "const a = 1\n",
    });

    symlinkSync("target.ts", path.join(repoRoot, "link.ts"));
    runGit(repoRoot, ["add", "link.ts"]);
    runGit(repoRoot, ["commit", "-m", "add link"]);
    const loaded = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });

    expect(
      loaded.repoFiles.find((repoFile) => repoFile.path === "link.ts")
    ).toMatchObject({
      symlink: true,
      tracked: true,
    });
    expect(
      loaded.repoFiles.find((repoFile) => repoFile.path === "target.ts")
    ).toMatchObject({
      symlink: false,
      tracked: true,
    });
  });

  test("re-resolves an untracked file's symlink flag when its type flips", async () => {
    const repoRoot = createFixtureRepo("stet-git-symlink-flip-", {
      "a.ts": "const a = 1\n",
    });

    // Same path and identical git output both times, so only the on-disk type
    // Changes: the repo-file cache must not mask the flip behind a stale flag.
    writeFileSync(path.join(repoRoot, "link"), "plain\n");
    const before = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    expect(
      before.repoFiles.find((repoFile) => repoFile.path === "link")
    ).toMatchObject({
      symlink: false,
    });

    rmSync(path.join(repoRoot, "link"));
    symlinkSync("a.ts", path.join(repoRoot, "link"));
    const after = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    expect(
      after.repoFiles.find((repoFile) => repoFile.path === "link")
    ).toMatchObject({
      symlink: true,
    });
  });

  test("keeps non-ascii filenames literal end to end", async () => {
    const repoRoot = createFixtureRepo("stet-git-unicode-", {
      "src/café.ts": "const a = 1\n",
    });

    writeFileSync(path.join(repoRoot, "src", "café.ts"), "const a = 2\n");
    const loaded = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    const changed = loaded.changedByPath.get("src/café.ts");
    expect(changed).toMatchObject({
      additions: 1,
      deletions: 1,
      kind: "modified",
    });
    expect(loaded.changed).toHaveLength(1);

    if (changed === undefined) {
      throw new Error("unicode file missing from model");
    }

    expect(
      await changedLines(
        await loadFileDiff(
          loaded.repoRoot,
          { kind: "all", ref: "HEAD" },
          changed
        )
      )
    ).toEqual(["-const a = 1", "+const a = 2"]);
  });

  test("forces canonical a//b/ prefixes despite hostile diff config", async () => {
    const repoRoot = createFixtureRepo("stet-git-prefix-", {
      "src/a.ts": "const a = 1\n",
    });

    runGit(repoRoot, ["config", "diff.noprefix", "true"]);
    runGit(repoRoot, ["config", "diff.mnemonicPrefix", "true"]);
    // One-sided CRLF sends the file to git's own pathspec diff, the path the
    // Prefix flags protect.
    writeFileSync(path.join(repoRoot, "src", "a.ts"), "const a = 2\r\n");

    const scope = { kind: "all", ref: "HEAD" } as const;
    const loaded = await loadModel(repoRoot, scope);
    const changed = loaded.changedByPath.get("src/a.ts");

    if (changed === undefined) {
      throw new Error("changed file missing from model");
    }

    const diff = await loadFileDiff(loaded.repoRoot, scope, changed);

    if (!("patch" in diff)) {
      throw new Error("expected git's fallback patch");
    }

    expect(diff.patch).toContain("--- a/src/a.ts");
    expect(diff.patch).toContain("+++ b/src/a.ts");
  });

  test("diffs a rename as a rename, not a whole-file add", async () => {
    const content = Array.from(
      { length: 12 },
      (_, index) => `const line${index} = ${index}`
    ).join("\n");

    const repoRoot = createFixtureRepo("stet-git-rename-", {
      "src/old.ts": `${content}\n`,
    });

    renameSync(
      path.join(repoRoot, "src", "old.ts"),
      path.join(repoRoot, "src", "new.ts")
    );
    writeFileSync(
      path.join(repoRoot, "src", "new.ts"),
      `${content}\nconst added = true\n`
    );
    runGit(repoRoot, ["add", "-A"]);

    const scope = { kind: "all", ref: "HEAD" } as const;
    const loaded = await loadModel(repoRoot, scope);
    const renamed = loaded.changedByPath.get("src/new.ts");
    expect(renamed).toMatchObject({ kind: "renamed", oldPath: "src/old.ts" });

    if (renamed === undefined) {
      throw new Error("renamed file missing from model");
    }

    expect(
      await changedLines(await loadFileDiff(loaded.repoRoot, scope, renamed))
    ).toEqual(["+const added = true"]);
  });

  test("a commit scope loads exactly the files that commit introduced", async () => {
    const repoRoot = createFixtureRepo("stet-git-commit-scope-", {
      "a.txt": "one\n",
    });

    writeFileSync(path.join(repoRoot, "b.txt"), "two\n");
    runGit(repoRoot, ["add", "."]);
    runGit(repoRoot, ["commit", "-m", "add b"]);
    writeFileSync(path.join(repoRoot, "c.txt"), "three\n");
    runGit(repoRoot, ["add", "."]);
    runGit(repoRoot, ["commit", "-m", "add c"]);

    const commits = await loadRecentCommits(repoRoot, 30);
    const middle = commits.find((commit) => commit.subject === "add b");

    if (middle?.parent === undefined) {
      throw new Error(
        "middle commit missing, or missing the parent it was committed onto"
      );
    }

    const scope = {
      headRef: middle.sha,
      kind: "commit",
      ref: middle.parent,
    } as const;

    const loaded = await loadModel(repoRoot, scope);

    expect(loaded.changed.map((entry) => entry.path)).toEqual(["b.txt"]);

    const added = loaded.changedByPath.get("b.txt");

    if (added === undefined) {
      throw new Error("b.txt missing from the commit model");
    }

    expect(
      await changedLines(await loadFileDiff(loaded.repoRoot, scope, added))
    ).toEqual(["+two"]);
  });
});

describe("mergeChanged", () => {
  test("returns the same reference when nothing changed", () => {
    const prev = model([file("a.ts"), file("b.ts")]);
    const next = model([file("a.ts"), file("b.ts")]);
    expect(mergeChanged(prev, next)).toBe(prev);
  });

  test("takes the next files when churn changes", () => {
    const prev = model([file("a.ts")]);
    const next = model([file("a.ts", { additions: 9 })]);
    const merged = mergeChanged(prev, next);
    expect(merged).not.toBe(prev);
    expect(merged.changedByPath).toBe(next.changedByPath);
  });

  test("returns a fresh model when the scope changes, even with identical content", () => {
    const stable = file("a.ts");
    const prev = model([stable], "key", "all:HEAD");
    const next = model([file("a.ts")], "key", "unstaged:HEAD");
    const merged = mergeChanged(prev, next);
    expect(merged).not.toBe(prev);
    expect(merged.scopeKey).toBe("unstaged:HEAD");
    expect(merged.changedByPath.get("a.ts")).toBe(stable);
  });

  test("takes the next file when only its mtime changes", () => {
    const prev = model([file("a.ts", { mtimeMs: 1 })]);
    const next = model([file("a.ts", { mtimeMs: 2 })]);
    expect(mergeChanged(prev, next).changedByPath.get("a.ts")?.mtimeMs).toBe(2);
  });

  test("keeps identity for untouched files when other files churn", () => {
    const stable = file("a.ts");
    const prev = model([stable, file("b.ts")]);
    const next = model([file("a.ts"), file("b.ts", { additions: 9 })]);
    const merged = mergeChanged(prev, next);
    expect(merged).not.toBe(prev);
    expect(merged.changedByPath.get("a.ts")).toBe(stable);
    expect(merged.changedByPath.get("b.ts")).toBe(
      next.changedByPath.get("b.ts")
    );
  });
});

describe("changedPathsDiffer", () => {
  test("is false when only counts/stage/mtime churn", () => {
    const previous = [file("a.ts"), file("b.ts")];

    const next = [
      file("a.ts", { additions: 9, deletions: 4, mtimeMs: 99 }),
      file("b.ts"),
    ];

    expect(changedPathsDiffer(previous, next)).toBe(false);
  });

  test("is true when a path appears or disappears", () => {
    const previous = [file("a.ts"), file("b.ts")];
    expect(changedPathsDiffer(previous, [file("a.ts")])).toBe(true);
    expect(
      changedPathsDiffer(previous, [file("a.ts"), file("b.ts"), file("c.ts")])
    ).toBe(true);
  });

  test("is true when a path is renamed even at the same count", () => {
    expect(changedPathsDiffer([file("a.ts")], [file("renamed.ts")])).toBe(true);
  });
});
