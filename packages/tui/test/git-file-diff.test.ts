import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { DiffScope } from "@/cli";
import { renderDiff } from "@/diff/engine";
import type { NavigableLine } from "@/diff/rows";
import { diffArgs, untrackedDiffArgs } from "@/git/model";
import type { ChangedFile } from "@/git/model";
import { stripGitEnv } from "@/utils/env";

import {
  createFixtureRepo,
  loadBinaryMeta,
  loadFileDiff,
  loadModel,
  runGit,
} from "../test/helpers";

const u32be = (n: number) => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, n);

  return [...bytes];
};

// A minimal valid PNG header (width/height in the IHDR) plus optional trailing padding
// To vary the byte size; the NUL bytes make git and stet both classify it binary.
const png = (width: number, height: number, pad = 0): Uint8Array =>
  Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0,
    0,
    0,
    13,
    0x49,
    0x48,
    0x44,
    0x52,
    ...u32be(width),
    ...u32be(height),
    ...Array.from({ length: pad }, () => 0),
  ]);

// The slow pathspec invocation this change replaced, captured directly so a test
// Asserts the in-process patch renders the same rows git's own diff would.
const pathspecDiff = (
  repoRoot: string,
  scope: DiffScope,
  file: ChangedFile
) => {
  const args =
    file.kind === "untracked"
      ? untrackedDiffArgs(file.path).slice(1)
      : [
          ...diffArgs(scope).slice(1),
          "--",
          ...(file.oldPath === undefined
            ? [file.path]
            : [file.oldPath, file.path]),
        ];

  // `git diff` exits 1 when there are differences (and always with --no-index),
  // Which execFileSync throws on; the patch text is still on stdout.
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf-8",
      env: stripGitEnv(process.env),
    });
  } catch (error) {
    if (error instanceof Error && "stdout" in error) {
      return String(error.stdout);
    }

    throw error;
  }
};

const rows = async (patch: string): Promise<NavigableLine[]> => {
  const { navigable } = await renderDiff({ full: true, maxLines: 4000, patch });

  return navigable;
};

const changedFile = async (
  repoRoot: string,
  scope: DiffScope,
  file: string
) => {
  const model = await loadModel(repoRoot, scope);
  const changed = model.changedByPath.get(file);

  if (changed === undefined) {
    throw new Error(`${file} not in the ${scope.kind} changed set`);
  }

  return changed;
};

// The in-process fileDiff and git's own pathspec diff must render identical rows.
// Row equality (not patch bytes) tolerates legitimate equal-cost hunk-placement
// Drift between jsdiff's Myers and git's xdiff.
const expectSameRows = async (
  repoRoot: string,
  scope: DiffScope,
  filePath: string
) => {
  const file = await changedFile(repoRoot, scope, filePath);
  const { patch } = await loadFileDiff(repoRoot, scope, file);
  expect(await rows(patch)).toEqual(
    await rows(pathspecDiff(repoRoot, scope, file))
  );

  return patch;
};

const head = (repoRoot: string) =>
  execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf-8",
    env: stripGitEnv(process.env),
  }).trim();

describe("in-process fileDiff matches git", () => {
  test("modified file, all scope", async () => {
    const repoRoot = createFixtureRepo("stet-fd-mod-", {
      "src/a.ts": "one\ntwo\nthree\nfour\nfive\n",
    });

    writeFileSync(
      path.join(repoRoot, "src/a.ts"),
      "one\ntwo\nCHANGED\nfour\nfive\n"
    );
    await expectSameRows(repoRoot, { kind: "all", ref: "HEAD" }, "src/a.ts");
  });

  test("modified file, unstaged scope diffs against the index", async () => {
    const repoRoot = createFixtureRepo("stet-fd-unstaged-", {
      "src/a.ts": "one\ntwo\nthree\n",
    });

    writeFileSync(path.join(repoRoot, "src/a.ts"), "one\nstaged\nthree\n");
    runGit(repoRoot, ["add", "src/a.ts"]);
    writeFileSync(path.join(repoRoot, "src/a.ts"), "one\nstaged\nworktree\n");
    await expectSameRows(
      repoRoot,
      { kind: "unstaged", ref: "HEAD" },
      "src/a.ts"
    );
  });

  test("staged edit does not leak the worktree edit stacked on top", async () => {
    const repoRoot = createFixtureRepo("stet-fd-staged-", {
      "src/a.ts": "one\ntwo\nthree\n",
    });

    writeFileSync(path.join(repoRoot, "src/a.ts"), "one\nSTAGED\nthree\n");
    runGit(repoRoot, ["add", "src/a.ts"]);
    // A further worktree-only edit that must NOT appear in the staged diff.
    writeFileSync(path.join(repoRoot, "src/a.ts"), "one\nSTAGED\nWORKTREE\n");

    const scope: DiffScope = { kind: "staged", ref: "HEAD" };
    const inProcess = await expectSameRows(repoRoot, scope, "src/a.ts");
    expect(inProcess).toContain("+STAGED");
    expect(inProcess).not.toContain("WORKTREE");
  });

  test("added file, staged scope", async () => {
    const repoRoot = createFixtureRepo("stet-fd-add-staged-", {
      "src/keep.ts": "keep\n",
    });

    writeFileSync(path.join(repoRoot, "src/new.ts"), "hello\nworld\n");
    runGit(repoRoot, ["add", "src/new.ts"]);
    await expectSameRows(
      repoRoot,
      { kind: "staged", ref: "HEAD" },
      "src/new.ts"
    );
  });

  test("added file tracked in the all scope", async () => {
    const repoRoot = createFixtureRepo("stet-fd-add-all-", {
      "src/keep.ts": "keep\n",
    });

    writeFileSync(path.join(repoRoot, "src/new.ts"), "hello\nworld\n");
    runGit(repoRoot, ["add", "src/new.ts"]);
    await expectSameRows(repoRoot, { kind: "all", ref: "HEAD" }, "src/new.ts");
  });

  test("deleted file, unstaged scope", async () => {
    const repoRoot = createFixtureRepo("stet-fd-del-", {
      "src/a.ts": "one\ntwo\nthree\n",
    });

    rmSync(path.join(repoRoot, "src/a.ts"));
    await expectSameRows(
      repoRoot,
      { kind: "unstaged", ref: "HEAD" },
      "src/a.ts"
    );
  });

  test("deleted file, staged scope (git rm)", async () => {
    const repoRoot = createFixtureRepo("stet-fd-del-staged-", {
      "src/a.ts": "one\ntwo\nthree\n",
    });

    runGit(repoRoot, ["rm", "src/a.ts"]);
    await expectSameRows(repoRoot, { kind: "staged", ref: "HEAD" }, "src/a.ts");
  });

  test("renamed file with an edit, staged scope", async () => {
    const repoRoot = createFixtureRepo("stet-fd-rename-", {
      "src/old.ts": "keep\nbefore\nkeep2\n",
    });

    runGit(repoRoot, ["mv", "src/old.ts", "src/new.ts"]);
    writeFileSync(path.join(repoRoot, "src/new.ts"), "keep\nafter\nkeep2\n");
    runGit(repoRoot, ["add", "src/new.ts"]);
    await expectSameRows(
      repoRoot,
      { kind: "staged", ref: "HEAD" },
      "src/new.ts"
    );
  });

  test("no trailing newline change", async () => {
    const repoRoot = createFixtureRepo("stet-fd-nonl-", {
      "a.txt": "line\n",
    });

    writeFileSync(path.join(repoRoot, "a.txt"), "line\nmore");
    await expectSameRows(repoRoot, { kind: "all", ref: "HEAD" }, "a.txt");
  });

  test("CRLF on both sides diffs in-process without falling back", async () => {
    const repoRoot = createFixtureRepo("stet-fd-crlf-", {
      "a.txt": "one\r\ntwo\r\nthree\r\n",
    });

    writeFileSync(path.join(repoRoot, "a.txt"), "one\r\nCHANGED\r\nthree\r\n");
    await expectSameRows(repoRoot, { kind: "all", ref: "HEAD" }, "a.txt");
  });

  test("a textconv'd fallback renders git's patch, never raw sides that disagree with it", async () => {
    // One-sided CRLF sends the file to git's own diff, which runs the textconv
    // Driver (here doubling every line), so its hunk numbers no longer match the
    // Raw bytes; filling the hunks from those bytes blanked the diff.
    const lines = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`);

    const repoRoot = createFixtureRepo("stet-fd-textconv-", {
      ".gitattributes": "*.txt diff=dbl -text\n",
      "a.txt": `${lines.join("\r\n")}\r\n`,
    });

    runGit(repoRoot, ["config", "diff.dbl.textconv", "sed G"]);
    writeFileSync(
      path.join(repoRoot, "a.txt"),
      `${lines.join("\n").replace("line 30", "LINE 30")}\n`
    );

    const scope: DiffScope = { kind: "all", ref: "HEAD" };
    const file = await changedFile(repoRoot, scope, "a.txt");
    const diff = await loadFileDiff(repoRoot, scope, file);

    expect(diff.sides).toBeUndefined();

    const { navigable } = await renderDiff({
      full: true,
      maxLines: 4000,
      ...diff,
    });

    expect(navigable.map((line) => line.content)).toContain("LINE 30");
  });

  test("path with spaces and non-ASCII characters", async () => {
    const repoRoot = createFixtureRepo("stet-fd-space-", {
      "src/a file café.ts": "one\ntwo\n",
    });

    writeFileSync(path.join(repoRoot, "src/a file café.ts"), "one\nCHANGED\n");
    await expectSameRows(
      repoRoot,
      { kind: "all", ref: "HEAD" },
      "src/a file café.ts"
    );
  });

  test("untracked file still routes through the /dev/null diff", async () => {
    const repoRoot = createFixtureRepo("stet-fd-untracked-", {
      "src/keep.ts": "keep\n",
    });

    writeFileSync(path.join(repoRoot, "src/new.ts"), "brand\nnew\n");

    const inProcess = await expectSameRows(
      repoRoot,
      { kind: "unstaged", ref: "HEAD" },
      "src/new.ts"
    );

    expect(await rows(inProcess)).toEqual([
      { content: "brand", newLine: 1, oldLine: undefined, type: "add" },
      { content: "new", newLine: 2, oldLine: undefined, type: "add" },
    ]);
  });

  test("binary file renders empty, like git's Binary files differ", async () => {
    const repoRoot = createFixtureRepo("stet-fd-bin-", {
      "keep.ts": "keep\n",
    });

    writeFileSync(
      path.join(repoRoot, "img.bin"),
      new Uint8Array([1, 2, 0, 3, 255, 0, 7])
    );
    runGit(repoRoot, ["add", "img.bin"]);
    const scope: DiffScope = { kind: "staged", ref: "HEAD" };
    const file = await changedFile(repoRoot, scope, "img.bin");
    expect(file.binary).toBe(true);

    const { patch } = await loadFileDiff(repoRoot, scope, file);

    expect(await rows(patch)).toEqual([]);
  });

  test("last-commit scope diffs the two committed trees", async () => {
    const repoRoot = createFixtureRepo("stet-fd-lastcommit-", {
      "src/a.ts": "one\ntwo\nthree\n",
    });

    writeFileSync(path.join(repoRoot, "src/a.ts"), "one\nCOMMITTED\nthree\n");
    writeFileSync(path.join(repoRoot, "src/added.ts"), "fresh\n");
    runGit(repoRoot, ["add", "."]);
    runGit(repoRoot, ["commit", "-m", "second"]);

    const parent = execFileSync("git", ["rev-parse", "HEAD~1"], {
      cwd: repoRoot,
      encoding: "utf-8",
      env: stripGitEnv(process.env),
    }).trim();

    const scope: DiffScope = {
      headRef: "HEAD",
      kind: "last-commit",
      ref: parent,
    };

    await expectSameRows(repoRoot, scope, "src/a.ts");
    await expectSameRows(repoRoot, scope, "src/added.ts");
  });

  test("session scope diffs the worktree against the pinned base SHA across a commit", async () => {
    const repoRoot = createFixtureRepo("stet-fd-session-", {
      "src/a.ts": "one\ntwo\nthree\n",
    });

    const base = head(repoRoot);
    writeFileSync(path.join(repoRoot, "src/a.ts"), "one\nCOMMITTED\nthree\n");
    runGit(repoRoot, ["add", "."]);
    runGit(repoRoot, ["commit", "-m", "mid-session commit"]);
    writeFileSync(
      path.join(repoRoot, "src/a.ts"),
      "one\nCOMMITTED\nWORKTREE\n"
    );

    await expectSameRows(repoRoot, { kind: "session", ref: base }, "src/a.ts");
  });
});

describe("binaryMeta reads both sides' size and dimensions", () => {
  test("an added binary reports only the new side", async () => {
    const repoRoot = createFixtureRepo("stet-bm-add-", { "keep.ts": "keep\n" });
    writeFileSync(path.join(repoRoot, "logo.png"), png(16, 8));
    runGit(repoRoot, ["add", "logo.png"]);

    const scope: DiffScope = { kind: "staged", ref: "HEAD" };
    const file = await changedFile(repoRoot, scope, "logo.png");
    expect(file.binary).toBe(true);
    expect(await loadBinaryMeta(repoRoot, scope, file)).toEqual({
      newSide: { bytes: 24, image: { format: "PNG", height: 8, width: 16 } },
      oldSide: undefined,
    });
  });

  test("a deleted binary reports only the old side", async () => {
    const repoRoot = createFixtureRepo("stet-bm-del-", { "keep.ts": "keep\n" });
    writeFileSync(path.join(repoRoot, "logo.png"), png(16, 8));
    runGit(repoRoot, ["add", "logo.png"]);
    runGit(repoRoot, ["commit", "-m", "add logo"]);
    runGit(repoRoot, ["rm", "logo.png"]);

    const scope: DiffScope = { kind: "staged", ref: "HEAD" };
    const file = await changedFile(repoRoot, scope, "logo.png");
    expect(await loadBinaryMeta(repoRoot, scope, file)).toEqual({
      newSide: undefined,
      oldSide: { bytes: 24, image: { format: "PNG", height: 8, width: 16 } },
    });
  });

  test("a modified binary reports both sides", async () => {
    const repoRoot = createFixtureRepo("stet-bm-mod-", { "keep.ts": "keep\n" });
    writeFileSync(path.join(repoRoot, "logo.png"), png(16, 8));
    runGit(repoRoot, ["add", "logo.png"]);
    runGit(repoRoot, ["commit", "-m", "add logo"]);
    writeFileSync(path.join(repoRoot, "logo.png"), png(32, 16, 100));

    const scope: DiffScope = { kind: "all", ref: "HEAD" };
    const file = await changedFile(repoRoot, scope, "logo.png");
    expect(await loadBinaryMeta(repoRoot, scope, file)).toEqual({
      newSide: { bytes: 124, image: { format: "PNG", height: 16, width: 32 } },
      oldSide: { bytes: 24, image: { format: "PNG", height: 8, width: 16 } },
    });
  });
});
