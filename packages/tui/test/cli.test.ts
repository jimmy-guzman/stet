import { describe, expect, test } from "bun:test";

import { helpText, parseArgs, parseCommand, scopeKinds, scopeLabel, scopeMenuLabel } from "@/cli";
import { keyHelpGroups } from "@/help/keys";

describe("parseArgs", () => {
  test("defaults to uncommitted vs HEAD", () => {
    expect(parseArgs([]).scope).toEqual({ kind: "all", ref: "HEAD" });
  });

  test("accepts a comparison ref", () => {
    expect(parseArgs(["main"]).scope).toEqual({ kind: "all", ref: "main" });
  });

  test("supports staged comparisons", () => {
    expect(parseArgs(["--staged", "HEAD~2"]).scope).toEqual({ kind: "staged", ref: "HEAD~2" });
  });

  test("supports unstaged comparisons", () => {
    expect(parseArgs(["--unstaged"]).scope).toEqual({ kind: "unstaged", ref: "HEAD" });
  });

  test("rejects --staged and --unstaged together", () => {
    expect(() => parseArgs(["--staged", "--unstaged"])).toThrow(
      "--staged and --unstaged are mutually exclusive",
    );
  });

  test("enables file-type icons by default", () => {
    expect(parseArgs([]).icons).toBe(true);
  });

  test("disables icons with --no-icons", () => {
    expect(parseArgs(["--no-icons"]).icons).toBe(false);
  });

  test("overflows long lines by default", () => {
    expect(parseArgs([]).overflow).toBe("scroll");
  });

  test("wraps long lines with --wrap", () => {
    expect(parseArgs(["--wrap"]).overflow).toBe("wrap");
  });

  test("accepts --editor as a separate argument", () => {
    expect(parseArgs(["--editor", "nvim +{line} {file}"]).editor).toBe("nvim +{line} {file}");
  });

  test("accepts --editor= inline syntax", () => {
    expect(parseArgs(["--editor=code --goto {file}:{line}"]).editor).toBe(
      "code --goto {file}:{line}",
    );
  });

  test("--editor does not affect scope", () => {
    const result = parseArgs(["--staged", "--editor", "hx {file}:{line}"]);
    expect(result.scope.kind).toBe("staged");
    expect(result.editor).toBe("hx {file}:{line}");
  });

  test("accepts --ide as a separate argument", () => {
    expect(parseArgs(["--ide", "code --goto {file}:{line}"]).ide).toBe("code --goto {file}:{line}");
  });

  test("accepts --ide= inline syntax", () => {
    expect(parseArgs(["--ide=zed {file}:{line}"]).ide).toBe("zed {file}:{line}");
  });

  test("--ide does not affect --editor or scope", () => {
    const result = parseArgs([
      "--editor",
      "nvim +{line} {file}",
      "--ide",
      "code --goto {file}:{line}",
    ]);
    expect(result.editor).toBe("nvim +{line} {file}");
    expect(result.ide).toBe("code --goto {file}:{line}");
    expect(result.scope.kind).toBe("all");
  });

  test("throws when --editor is empty", () => {
    expect(() => parseArgs(["--editor", ""])).toThrow("--editor requires a non-empty value");
  });

  test("throws when --ide is empty", () => {
    expect(() => parseArgs(["--ide", ""])).toThrow("--ide requires a non-empty value");
  });

  // A blank ref would otherwise reach git as one and come back reported as an unknown ref that
  // Names nothing, since `?? "HEAD"` only fills in a missing positional, not an empty one.
  test("throws when the ref positional is empty", () => {
    expect(() => parseArgs([""])).toThrow("<ref> requires a non-empty value");
  });

  test("throws when --editor has no value", () => {
    expect(() => parseArgs(["--editor"])).toThrow("Option '--editor <value>' argument missing");
  });

  test("throws when --ide has no value", () => {
    expect(() => parseArgs(["--ide"])).toThrow("Option '--ide <value>' argument missing");
  });

  test("editor defaults to undefined when not provided", () => {
    expect(parseArgs([]).editor).toBeUndefined();
  });

  test("ide defaults to undefined when not provided", () => {
    expect(parseArgs([]).ide).toBeUndefined();
  });

  test("rejects unknown options", () => {
    expect(() => parseArgs(["--nope"])).toThrow("Unknown option '--nope'");
  });
});

describe("parseCommand", () => {
  test("dispatches the upgrade subcommand", () => {
    expect(parseCommand(["upgrade"])).toEqual({ kind: "upgrade" });
  });

  test("rejects an extra argument after upgrade", () => {
    expect(() => parseCommand(["upgrade", "0.4.1"])).toThrow("Unexpected argument: 0.4.1");
  });

  test("rejects an unknown flag after upgrade", () => {
    expect(() => parseCommand(["upgrade", "--force"])).toThrow("Unknown option: --force");
  });

  test("falls through to the run command for everything else", () => {
    expect(parseCommand(["--staged", "main"])).toEqual({
      kind: "run",
      options: parseArgs(["--staged", "main"]),
    });
  });

  test("treats a bare ref as a run command", () => {
    const command = parseCommand(["main"]);
    expect(command.kind).toBe("run");
    expect(command.kind === "run" && command.options.scope).toEqual({ kind: "all", ref: "main" });
  });
});

describe("scopeKinds", () => {
  test("lists the scopes in picker order", () => {
    expect(scopeKinds).toEqual(["all", "staged", "unstaged", "session", "last-commit"]);
  });
});

describe("scopeLabel", () => {
  const SHA1_EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
  const SHA256_EMPTY_TREE = "6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321";

  test("labels each scope", () => {
    expect(scopeLabel({ kind: "all", ref: "HEAD" }, SHA1_EMPTY_TREE)).toBe("uncommitted vs HEAD");
    expect(scopeLabel({ kind: "staged", ref: "main" }, SHA1_EMPTY_TREE)).toBe("staged vs main");
    expect(scopeLabel({ kind: "unstaged", ref: "HEAD" }, SHA1_EMPTY_TREE)).toBe("unstaged");
    expect(scopeLabel({ kind: "session", ref: "abc123" }, SHA1_EMPTY_TREE)).toBe(
      "since session start",
    );
    expect(
      scopeLabel({ headRef: "HEAD", kind: "last-commit", ref: "abc123" }, SHA1_EMPTY_TREE),
    ).toBe("last commit");
  });

  // The empty-tree base is stet's own, not a ref the user named, and its sha crowded the branch off
  // The header, which shrinks the branch before the scope.
  test("names the empty-tree base rather than printing its sha", () => {
    expect(scopeLabel({ kind: "all", ref: SHA1_EMPTY_TREE }, SHA1_EMPTY_TREE)).toBe(
      "uncommitted vs no commits yet",
    );
    expect(scopeLabel({ kind: "staged", ref: SHA256_EMPTY_TREE }, SHA256_EMPTY_TREE)).toBe(
      "staged vs no commits yet",
    );
  });

  // A SHA-256 repository's empty tree is a different object, so recognizing the SHA-1 one would
  // Print 64 characters of sha into the header there.
  test("recognizes only this repository's empty tree", () => {
    expect(scopeLabel({ kind: "all", ref: SHA256_EMPTY_TREE }, SHA256_EMPTY_TREE)).toBe(
      "uncommitted vs no commits yet",
    );
    expect(scopeLabel({ kind: "all", ref: SHA1_EMPTY_TREE }, SHA256_EMPTY_TREE)).toBe(
      `uncommitted vs ${SHA1_EMPTY_TREE}`,
    );
  });

  // A scope picked from the menu before the startup load resolves keeps the ref it was given, and
  // The startup batch deliberately leaves a user-touched scope alone. The label has to follow that
  // Ref, not the base the repository would otherwise take, or it names an endpoint git never got.
  test("follows the scope's own ref when the base has moved on without it", () => {
    expect(scopeLabel({ kind: "staged", ref: "HEAD" }, SHA1_EMPTY_TREE)).toBe("staged vs HEAD");
  });
});

describe("scopeMenuLabel", () => {
  test("gives a ref-agnostic label per kind", () => {
    expect(scopeMenuLabel("unstaged")).toBe("unstaged");
    expect(scopeMenuLabel("staged")).toBe("staged");
    expect(scopeMenuLabel("all")).toBe("uncommitted");
    expect(scopeMenuLabel("session")).toBe("since session start");
    expect(scopeMenuLabel("last-commit")).toBe("last commit");
  });
});

describe("helpText", () => {
  test("documents every keybinding from the registry", () => {
    const help = helpText();
    for (const group of keyHelpGroups()) {
      expect(help).toContain(`${group.heading}:`);
      for (const entry of group.entries) {
        expect(help).toContain(entry.combo);
        expect(help).toContain(entry.description);
      }
    }
    expect(help).toContain("The view is live");
  });

  test("documents the --editor and --ide flags", () => {
    expect(helpText()).toContain("--editor <template>");
    expect(helpText()).toContain("--ide <template>");
    expect(helpText()).toContain("{file}");
    expect(helpText()).toContain("{line}");
  });

  test("documents the e and o keybindings", () => {
    expect(helpText()).toContain("open in terminal editor");
    expect(helpText()).toContain("open in GUI / IDE");
  });

  test("documents the upgrade command", () => {
    expect(helpText()).toContain("stet upgrade");
    expect(helpText()).toContain("Update stet to the latest release");
  });
});
