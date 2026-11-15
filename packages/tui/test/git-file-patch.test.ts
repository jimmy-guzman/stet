import { describe, expect, test } from "bun:test";

import { renderDiff } from "@/diff/engine";
import {
  buildDiffInput,
  classifySideBytes,
  fileDiffSides,
} from "@/git/file-patch";
import type { DiffInput, SideContent } from "@/git/file-patch";
import type { ChangedFile } from "@/git/model";

const file = (
  path: string,
  overrides: Partial<ChangedFile> = {}
): ChangedFile => ({
  additions: 1,
  binary: false,
  deletions: 1,
  kind: "modified",
  mtimeMs: 0,
  path,
  stage: "unstaged",
  warnings: [],
  ...overrides,
});

const text = (value: string): SideContent => ({ kind: "text", text: value });

const rows = async (input: DiffInput | undefined) => {
  if (input === undefined) {
    throw new Error("expected an in-process diff, not the git fallback");
  }

  const { navigable } = await renderDiff({
    full: true,
    maxLines: 1600,
    ...input,
  });

  return navigable;
};

describe("fileDiffSides", () => {
  test("all and session compare the ref blob against the worktree", () => {
    expect(
      fileDiffSides({ kind: "all", ref: "main" }, file("src/a.ts"))
    ).toEqual({
      newSide: { kind: "worktree" },
      oldSide: { kind: "git", spec: "main:src/a.ts" },
    });
    expect(
      fileDiffSides({ kind: "session", ref: "abc123" }, file("src/a.ts"))
    ).toEqual({
      newSide: { kind: "worktree" },
      oldSide: { kind: "git", spec: "abc123:src/a.ts" },
    });
  });

  test("unstaged compares the index blob against the worktree and ignores the ref", () => {
    expect(
      fileDiffSides({ kind: "unstaged", ref: "main" }, file("src/a.ts"))
    ).toEqual({
      newSide: { kind: "worktree" },
      oldSide: { kind: "git", spec: ":src/a.ts" },
    });
  });

  test("staged compares the ref blob against the index blob, never the worktree", () => {
    expect(
      fileDiffSides({ kind: "staged", ref: "HEAD" }, file("src/a.ts"))
    ).toEqual({
      newSide: { kind: "git", spec: ":src/a.ts" },
      oldSide: { kind: "git", spec: "HEAD:src/a.ts" },
    });
  });

  test("last-commit compares the two committed trees, defaulting the right side to HEAD", () => {
    expect(
      fileDiffSides(
        { headRef: "HEAD", kind: "last-commit", ref: "parentsha" },
        file("src/a.ts")
      )
    ).toEqual({
      newSide: { kind: "git", spec: "HEAD:src/a.ts" },
      oldSide: { kind: "git", spec: "parentsha:src/a.ts" },
    });
    expect(
      fileDiffSides({ kind: "last-commit", ref: "parentsha" }, file("src/a.ts"))
    ).toEqual({
      newSide: { kind: "git", spec: "HEAD:src/a.ts" },
      oldSide: { kind: "git", spec: "parentsha:src/a.ts" },
    });
  });

  test("a stepped commit compares the commit's parent tree against the commit sha", () => {
    expect(
      fileDiffSides(
        { headRef: "abcsha", kind: "commit", ref: "parentsha" },
        file("src/a.ts")
      )
    ).toEqual({
      newSide: { kind: "git", spec: "abcsha:src/a.ts" },
      oldSide: { kind: "git", spec: "parentsha:src/a.ts" },
    });
  });

  test("added and untracked files have no old side", () => {
    expect(
      fileDiffSides(
        { kind: "all", ref: "HEAD" },
        file("src/a.ts", { kind: "added" })
      )
    ).toEqual({
      newSide: { kind: "worktree" },
      oldSide: { kind: "empty" },
    });
    expect(
      fileDiffSides(
        { kind: "all", ref: "HEAD" },
        file("src/a.ts", { kind: "untracked" })
      )
    ).toEqual({
      newSide: { kind: "worktree" },
      oldSide: { kind: "empty" },
    });
  });

  test("deleted files have no new side", () => {
    expect(
      fileDiffSides(
        { kind: "all", ref: "HEAD" },
        file("src/a.ts", { kind: "deleted" })
      )
    ).toEqual({
      newSide: { kind: "empty" },
      oldSide: { kind: "git", spec: "HEAD:src/a.ts" },
    });
    expect(
      fileDiffSides(
        { kind: "staged", ref: "HEAD" },
        file("src/a.ts", { kind: "deleted" })
      )
    ).toEqual({
      newSide: { kind: "empty" },
      oldSide: { kind: "git", spec: "HEAD:src/a.ts" },
    });
  });

  test("renamed files read the old side at the pre-rename path", () => {
    expect(
      fileDiffSides(
        { kind: "all", ref: "HEAD" },
        file("src/new.ts", { kind: "renamed", oldPath: "src/old.ts" })
      )
    ).toEqual({
      newSide: { kind: "worktree" },
      oldSide: { kind: "git", spec: "HEAD:src/old.ts" },
    });
    expect(
      fileDiffSides(
        { kind: "staged", ref: "HEAD" },
        file("src/new.ts", { kind: "renamed", oldPath: "src/old.ts" })
      )
    ).toEqual({
      newSide: { kind: "git", spec: ":src/new.ts" },
      oldSide: { kind: "git", spec: "HEAD:src/old.ts" },
    });
  });
});

describe("classifySideBytes", () => {
  test("decodes text preserving the trailing newline", () => {
    expect(classifySideBytes(new TextEncoder().encode("a\nb\n"))).toEqual({
      kind: "text",
      text: "a\nb\n",
    });
    expect(classifySideBytes(new TextEncoder().encode("no newline"))).toEqual({
      kind: "text",
      text: "no newline",
    });
  });

  test("classifies a NUL byte in the first 8KB as binary", () => {
    expect(classifySideBytes(new Uint8Array([104, 105, 0, 33]))).toEqual({
      bytes: 4,
      kind: "binary",
    });
  });

  test("classifies an oversized side as too-large without decoding", () => {
    expect(classifySideBytes(new Uint8Array(10_000_001))).toEqual({
      kind: "too-large",
    });
  });
});

describe("buildDiffInput", () => {
  test("a modified file renders with git's three context lines", async () => {
    // Two unchanged lines beyond the context on each side: a one-line gap would
    // Render inline, hiding where the context ends.
    const built = buildDiffInput(
      file("src/a.ts"),
      text("a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk\n"),
      text("a\nb\nc\nd\ne\nCHANGED\ng\nh\ni\nj\nk\n")
    );

    expect(await rows(built)).toEqual([
      { content: "c", newLine: 3, oldLine: 3, type: "context" },
      { content: "d", newLine: 4, oldLine: 4, type: "context" },
      { content: "e", newLine: 5, oldLine: 5, type: "context" },
      { content: "f", newLine: undefined, oldLine: 6, type: "remove" },
      { content: "CHANGED", newLine: 6, oldLine: undefined, type: "add" },
      { content: "g", newLine: 7, oldLine: 7, type: "context" },
      { content: "h", newLine: 8, oldLine: 8, type: "context" },
      { content: "i", newLine: 9, oldLine: 9, type: "context" },
    ]);
  });

  test("an added file has no old side and renders all-added", async () => {
    const built = buildDiffInput(
      file("src/a.ts", { additions: 2, deletions: 0, kind: "added" }),
      text(""),
      text("hello\nworld\n")
    );

    expect(built).toEqual({
      files: {
        newFile: { contents: "hello\nworld\n", name: "src/a.ts" },
        oldFile: null,
      },
    });
    expect(await rows(built)).toEqual([
      { content: "hello", newLine: 1, oldLine: undefined, type: "add" },
      { content: "world", newLine: 2, oldLine: undefined, type: "add" },
    ]);
  });

  test("a deleted file has no new side and renders all-removed", async () => {
    const built = buildDiffInput(
      file("src/a.ts", { additions: 0, deletions: 2, kind: "deleted" }),
      text("hello\nworld\n"),
      text("")
    );

    expect(built).toEqual({
      files: {
        newFile: null,
        oldFile: { contents: "hello\nworld\n", name: "src/a.ts" },
      },
    });
    expect(await rows(built)).toEqual([
      { content: "hello", newLine: undefined, oldLine: 1, type: "remove" },
      { content: "world", newLine: undefined, oldLine: 2, type: "remove" },
    ]);
  });

  test("a rename names each side by its own path", async () => {
    const built = buildDiffInput(
      file("src/new.ts", { kind: "renamed", oldPath: "src/old.ts" }),
      text("keep\nbefore\n"),
      text("keep\nafter\n")
    );

    expect(built).toEqual({
      files: {
        newFile: { contents: "keep\nafter\n", name: "src/new.ts" },
        oldFile: { contents: "keep\nbefore\n", name: "src/old.ts" },
      },
    });
    expect(await rows(built)).toEqual([
      { content: "keep", newLine: 1, oldLine: 1, type: "context" },
      { content: "before", newLine: undefined, oldLine: 2, type: "remove" },
      { content: "after", newLine: 2, oldLine: undefined, type: "add" },
    ]);
  });

  test("a pure rename renders no rows, like git", async () => {
    const built = buildDiffInput(
      file("src/new.ts", {
        additions: 0,
        deletions: 0,
        kind: "renamed",
        oldPath: "src/old.ts",
      }),
      text("same\n"),
      text("same\n")
    );

    expect(await rows(built)).toEqual([]);
  });

  test("a missing trailing newline still renders the changed line", async () => {
    expect(
      await rows(buildDiffInput(file("a.txt"), text("end\n"), text("end")))
    ).toEqual([
      { content: "end", newLine: undefined, oldLine: 1, type: "remove" },
      { content: "end", newLine: 1, oldLine: undefined, type: "add" },
    ]);
  });

  test("a binary side yields an empty patch, matching the model-driven placeholder", () => {
    expect(
      buildDiffInput(file("a.bin"), { bytes: 4, kind: "binary" }, text("x\n"))
    ).toEqual({ patch: "" });
    expect(
      buildDiffInput(file("a.bin"), text("x\n"), { bytes: 4, kind: "binary" })
    ).toEqual({ patch: "" });
  });

  test("a missing or oversized side falls back to the git invocation", () => {
    expect(
      buildDiffInput(file("a.txt"), { kind: "missing" }, text("x\n"))
    ).toBeUndefined();
    expect(
      buildDiffInput(file("a.txt"), text("x\n"), { kind: "too-large" })
    ).toBeUndefined();
  });

  test("CRLF on exactly one side falls back; CRLF on both sides diffs in-process", () => {
    expect(
      buildDiffInput(file("a.txt"), text("a\r\nb\r\n"), text("a\nc\n"))
    ).toBeUndefined();
    expect(
      buildDiffInput(file("a.txt"), text("a\r\nb\r\n"), text("a\r\nc\r\n"))
    ).toBeDefined();
  });

  test("a two-sided rewrite over the diff budget falls back without diffing", () => {
    const lines = Array.from({ length: 20_000 }, (_, i) => `${i}\n`);

    expect(
      buildDiffInput(
        file("a.txt", { additions: 20_000, deletions: 20_000 }),
        text(lines.map((line) => `old ${line}`).join("")),
        text(lines.map((line) => `new ${line}`).join(""))
      )
    ).toBeUndefined();
  });

  test("edits far inside a large file stay in-process, since only the changed middle counts", async () => {
    const lines = Array.from({ length: 50_000 }, (_, i) => `line ${i}\n`);
    const edited = lines.with(25_000, "changed\n");

    const built = buildDiffInput(
      file("a.txt"),
      text(lines.join("")),
      text(edited.join(""))
    );

    const rendered = await rows(built);

    expect(rendered.filter((line) => line.type !== "context")).toEqual([
      {
        content: "line 25000",
        newLine: undefined,
        oldLine: 25_001,
        type: "remove",
      },
      { content: "changed", newLine: 25_001, oldLine: undefined, type: "add" },
    ]);
  });

  test("edits at both ends of a large file stay in-process, bounded by its unchanged unique lines", () => {
    const lines = Array.from({ length: 20_000 }, (_, i) => `line ${i}\n`);
    const edited = lines.with(0, "first\n").with(19_999, "last\n");

    expect(
      buildDiffInput(
        file("a.txt", { additions: 2, deletions: 2 }),
        text(lines.join("")),
        text(edited.join(""))
      )
    ).toBeDefined();
  });

  test("edits at both ends of a file of repeated lines stay in-process", () => {
    // Half of these lines (`}` and blank) repeat, so they cannot be patience anchors;
    // They match from the ends of the gaps between the unique lines instead.
    const lines = Array.from(
      { length: 5000 },
      (_, i) => `function f${i}() {\n  return ${i};\n}\n\n`
    );

    const edited = lines
      .with(1, "function first() {\n  return 1;\n}\n\n")
      .with(4998, "function last() {\n  return 4998;\n}\n\n");

    expect(
      buildDiffInput(
        file("a.ts", { additions: 2, deletions: 2 }),
        text(lines.join("")),
        text(edited.join(""))
      )
    ).toBeDefined();
  });

  test("a missing trailing newline renders git's no-newline row", async () => {
    const built = buildDiffInput(file("a.txt"), text("end\n"), text("end"));

    if (built === undefined) {
      throw new Error("expected an in-process diff");
    }

    const { rows: rendered } = await renderDiff({
      full: true,
      maxLines: 1600,
      ...built,
    });

    expect(rendered).toContainEqual({
      glyph: "\\",
      kind: "separator",
      text: "No newline at end of file",
    });
  });

  test("adding a large file stays in-process, since a one-sided diff is linear", () => {
    const contents = Array.from({ length: 100_000 }, (_, i) => `${i}\n`).join(
      ""
    );

    expect(
      buildDiffInput(
        file("big.txt", { additions: 100_000, deletions: 0, kind: "added" }),
        text(""),
        text(contents)
      )
    ).toBeDefined();
  });

  test("identical text against non-zero numstat counts falls back instead of rendering empty", () => {
    expect(
      buildDiffInput(
        file("a.txt", { additions: 2, deletions: 1 }),
        text("same\n"),
        text("same\n")
      )
    ).toBeUndefined();
  });

  test("identical text with zero numstat counts renders empty, like a mode-only change", async () => {
    expect(
      await rows(
        buildDiffInput(
          file("a.txt", { additions: 0, deletions: 0 }),
          text("same\n"),
          text("same\n")
        )
      )
    ).toEqual([]);
  });

  test("adding an empty file renders no rows", async () => {
    expect(
      await rows(
        buildDiffInput(
          file("empty.txt", { additions: 0, deletions: 0, kind: "added" }),
          text(""),
          text("")
        )
      )
    ).toEqual([]);
  });
});
