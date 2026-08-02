import { describe, expect, test } from "bun:test";

import {
  classifyRepoFailure,
  classifyRepoOutput,
  emptyTreeForFormat,
  isMissingGit,
  parseRepoContext,
  repoFailureMessage,
  unknownRefMessage,
} from "@/git/repo";

const SHA1_EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const SHA256_EMPTY_TREE = "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321";

describe("emptyTreeForFormat", () => {
  test("names the empty tree for each of git's hash algorithms", () => {
    expect(emptyTreeForFormat("sha1")).toBe(SHA1_EMPTY_TREE);
    expect(emptyTreeForFormat("sha256")).toBe(SHA256_EMPTY_TREE);
  });

  // Git documents sha1 as the default object format, so a token from some later git takes it rather
  // Than leaving the caller without a base at all.
  test("takes git's default format for a token it does not know", () => {
    expect(emptyTreeForFormat("sha3")).toBe(SHA1_EMPTY_TREE);
  });
});

describe("parseRepoContext", () => {
  test("reads the repo root and strips /.git off the common dir", () => {
    expect(parseRepoContext("/repo\n/repo/.git\nsha1\n")).toEqual({
      emptyTree: SHA1_EMPTY_TREE,
      mainWorktreePath: "/repo",
      repoRoot: "/repo",
    });
  });

  // The whole point of reading the format: a SHA-256 repository's empty tree is a different object,
  // And naming the SHA-1 one hands git something its database does not contain.
  test("reads the empty tree from the repository's object format", () => {
    expect(parseRepoContext("/repo\n/repo/.git\nsha256\n")?.emptyTree).toBe(SHA256_EMPTY_TREE);
  });

  test("resolves a linked worktree's main worktree from the shared common dir", () => {
    expect(parseRepoContext("/repo/.worktrees/feature\n/repo/.git\nsha1\n")).toEqual({
      emptyTree: SHA1_EMPTY_TREE,
      mainWorktreePath: "/repo",
      repoRoot: "/repo/.worktrees/feature",
    });
  });

  // A common dir that is not <main>/.git (a --separate-git-dir checkout) leaves the repo root as
  // The recovery target rather than inventing a parent that may not exist.
  test("falls back to the repo root when the common dir is elsewhere", () => {
    expect(parseRepoContext("/repo\n/elsewhere/store\nsha1\n")).toEqual({
      emptyTree: SHA1_EMPTY_TREE,
      mainWorktreePath: "/repo",
      repoRoot: "/repo",
    });
  });

  // Git before an option echoes it back and exits 0, so a successful command can still carry an
  // Unusable answer.
  test("rejects output whose first line is an echoed option", () => {
    expect(parseRepoContext("--path-format=absolute\n/repo\n.git\n")).toBeUndefined();
  });

  // The same signal in the format's slot, where there is no absolute-path check to catch it: an
  // Echoed option must never be read as the name of a hash algorithm.
  test("rejects an echoed option in place of the object format", () => {
    expect(parseRepoContext("/repo\n/repo/.git\n--show-object-format\n")).toBeUndefined();
  });

  test("rejects a relative common dir", () => {
    expect(parseRepoContext("/repo\n.git\nsha1\n")).toBeUndefined();
  });

  test("rejects output that is not two paths and a format", () => {
    expect(parseRepoContext("/repo\n/repo/.git\n")).toBeUndefined();
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

describe("isMissingGit", () => {
  test("reads a spawn failure with no exit code as a missing git", () => {
    expect(isMissingGit({ exitCode: -1, message: 'Executable not found in $PATH: "git"' })).toBe(
      true,
    );
  });

  // Process reports a vanished cwd the same way, and that is not a missing binary.
  test("does not claim a non-ENOENT spawn failure", () => {
    expect(
      isMissingGit({ exitCode: -1, message: "working directory no longer exists: /gone" }),
    ).toBe(false);
  });

  test("does not claim a git that ran and exited non-zero", () => {
    expect(isMissingGit({ exitCode: 128, message: "git rev-parse ... failed with exit 128" })).toBe(
      false,
    );
  });
});

// The classification reads the bare check's exit code rather than git's stderr, which is translated:
// Matching English text would classify an English user and drop every other one.
describe("classifyRepoFailure", () => {
  test("reads a bare check that answered as a repository with no working tree here", () => {
    expect(classifyRepoFailure({ exitCode: 0 })).toBe("bare-repo");
  });

  test("reads a bare check that failed as no repository at all", () => {
    expect(classifyRepoFailure({ exitCode: 128 })).toBe("not-a-repo");
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
