import { describe, expect, test } from "bun:test";

import {
  classifyRepoFailure,
  classifyRepoOutput,
  parseRepoContext,
  repoFailureMessage,
  unknownRefMessage,
} from "@/git/repo";

describe("parseRepoContext", () => {
  test("reads the repo root and strips /.git off the common dir", () => {
    expect(parseRepoContext("/repo\n/repo/.git\n")).toEqual({
      mainWorktreePath: "/repo",
      repoRoot: "/repo",
    });
  });

  test("resolves a linked worktree's main worktree from the shared common dir", () => {
    expect(parseRepoContext("/repo/.worktrees/feature\n/repo/.git\n")).toEqual({
      mainWorktreePath: "/repo",
      repoRoot: "/repo/.worktrees/feature",
    });
  });

  // A common dir that is not <main>/.git (a --separate-git-dir checkout) leaves the repo root as
  // The recovery target rather than inventing a parent that may not exist.
  test("falls back to the repo root when the common dir is elsewhere", () => {
    expect(parseRepoContext("/repo\n/elsewhere/store\n")).toEqual({
      mainWorktreePath: "/repo",
      repoRoot: "/repo",
    });
  });

  // Git before --path-format echoes the option back and exits 0, so a successful command can still
  // Carry an unusable answer.
  test("rejects output whose first line is an echoed option", () => {
    expect(parseRepoContext("--path-format=absolute\n/repo\n.git\n")).toBeUndefined();
  });

  test("rejects a relative common dir", () => {
    expect(parseRepoContext("/repo\n.git\n")).toBeUndefined();
  });

  test("rejects output that is not two paths", () => {
    expect(parseRepoContext("/repo\n")).toBeUndefined();
    expect(parseRepoContext("")).toBeUndefined();
  });
});

describe("classifyRepoOutput", () => {
  test("reads an echoed option as a git too old to understand it", () => {
    expect(classifyRepoOutput("--path-format=absolute\n/repo\n.git\n")).toBe("unsupported-git");
  });

  test("reads anything else unusable as an unclassified failure", () => {
    expect(classifyRepoOutput("/repo\n")).toBe("other");
  });
});

describe("classifyRepoFailure", () => {
  test("reads a spawn failure with no exit code as a missing git", () => {
    expect(
      classifyRepoFailure({
        exitCode: -1,
        message: 'Executable not found in $PATH: "git"',
        stderr: "",
      }),
    ).toBe("missing-git");
  });

  // Process reports a vanished cwd the same way, and that is not a missing binary.
  test("keeps a non-ENOENT spawn failure unclassified", () => {
    expect(
      classifyRepoFailure({
        exitCode: -1,
        message: "working directory no longer exists: /gone",
        stderr: "",
      }),
    ).toBe("other");
  });

  test("reads git's own not-a-repository line", () => {
    expect(
      classifyRepoFailure({
        exitCode: 128,
        message: "git rev-parse ... failed with exit 128",
        stderr: "fatal: not a git repository (or any of the parent directories): .git\n",
      }),
    ).toBe("not-a-repo");
  });

  test("reads the work-tree line a bare repository and a .git directory both produce", () => {
    expect(
      classifyRepoFailure({
        exitCode: 128,
        message: "git rev-parse ... failed with exit 128",
        stderr: "fatal: this operation must be run in a work tree\n",
      }),
    ).toBe("bare-repo");
  });

  test("leaves an unrecognized git failure unclassified", () => {
    expect(
      classifyRepoFailure({
        exitCode: 128,
        message: "git rev-parse ... failed with exit 128",
        stderr: "fatal: bad object HEAD\n",
      }),
    ).toBe("other");
  });
});

describe("repoFailureMessage", () => {
  test("names each failure without quoting stet's own invocation", () => {
    expect(repoFailureMessage("missing-git", "/work", "")).toBe(
      "git is not installed, or not on PATH",
    );
    expect(repoFailureMessage("not-a-repo", "/work", "")).toBe("not a git repository: /work");
    expect(repoFailureMessage("bare-repo", "/work", "")).toBe("no git working tree at /work");
    expect(repoFailureMessage("unsupported-git", "/work", "")).toBe(
      'this git is too old for stet: it does not support "git rev-parse --path-format"',
    );
  });

  // The unclassified case is the only one that repeats git, and only its first line: the rest is
  // The "use '--' to separate paths" boilerplate that made the original report unreadable.
  test("quotes only git's first stderr line when it has nothing better to say", () => {
    expect(
      repoFailureMessage("other", "/work", "fatal: bad object HEAD\nUse '--' to separate paths\n"),
    ).toBe("could not read the git repository at /work: fatal: bad object HEAD");
  });

  test("says only what it knows when git said nothing", () => {
    expect(repoFailureMessage("other", "/work", "   \n")).toBe(
      "could not read the git repository at /work",
    );
  });
});

test("unknownRefMessage names the ref the user passed", () => {
  expect(unknownRefMessage("nosuchref")).toBe("unknown git ref: nosuchref");
});
