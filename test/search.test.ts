import { describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Effect, Layer } from "effect";

import { filterPathspecs, parseSearchOutput, searchArgs } from "@/git/search";
import { Git, GitLive } from "@/git/service";
import { ProcessLive } from "@/process";

import { createFixtureRepo } from "./helpers";

const literal = { caseSensitive: false, regex: false };

describe("searchArgs", () => {
  test("a lowercase query is case-insensitive", () => {
    expect(searchArgs("needle", undefined, literal)).toContain("-i");
  });

  test("an uppercase character makes the query case-sensitive", () => {
    expect(searchArgs("Needle", undefined, literal)).not.toContain("-i");
  });

  test("the case toggle forces sensitivity even for a lowercase query", () => {
    expect(searchArgs("needle", undefined, { caseSensitive: true, regex: false })).not.toContain(
      "-i",
    );
  });

  test("a literal search is fixed-string", () => {
    const args = searchArgs("needle", undefined, literal);
    expect(args).toContain("-F");
    expect(args).not.toContain("-E");
  });

  test("the regex toggle swaps fixed-string for extended regex", () => {
    const args = searchArgs("need.e+", undefined, { caseSensitive: false, regex: true });
    expect(args).toContain("-E");
    expect(args).not.toContain("-F");
  });

  test("asks for match columns", () => {
    expect(searchArgs("needle", undefined, literal)).toContain("--column");
  });

  test("whole-repo search passes no pathspec", () => {
    expect(searchArgs("needle", undefined, literal)).not.toContain("--");
  });

  test("changed-scope search limits to the given paths", () => {
    const args = searchArgs("needle", ["src/a.ts", "src/b.ts"], literal);
    expect(args.slice(args.indexOf("--"))).toEqual(["--", "src/a.ts", "src/b.ts"]);
  });
});

describe("filterPathspecs", () => {
  test("globs pass through as pathspecs", () => {
    expect(filterPathspecs("src/ *.ts")).toEqual(["src/", "*.ts"]);
  });

  test("a ! prefix maps to a git exclude pathspec", () => {
    expect(filterPathspecs("!*.test.ts")).toEqual([":(exclude)*.test.ts"]);
  });

  test("includes and excludes mix in one field", () => {
    expect(filterPathspecs("src/ !src/vendor *.ts")).toEqual([
      "src/",
      ":(exclude)src/vendor",
      "*.ts",
    ]);
  });

  test("a bare ! is dropped", () => {
    expect(filterPathspecs("! src/")).toEqual(["src/"]);
  });

  test("raw pathspec magic passes verbatim", () => {
    expect(filterPathspecs(":(exclude)dist")).toEqual([":(exclude)dist"]);
  });

  test("blank input means no filter", () => {
    expect(filterPathspecs("")).toBeUndefined();
    expect(filterPathspecs("  ")).toBeUndefined();
    expect(filterPathspecs("!")).toBeUndefined();
  });
});

describe("parseSearchOutput", () => {
  const bytes = (output: string) => new TextEncoder().encode(output);

  test(String.raw`parses NUL-framed path\0line\0column\0text records`, () => {
    const output =
      "src/a.ts\x002\x009\x00  const needle = 1\nsrc/b.ts\x0010\x008\x00return needle\n";
    expect(parseSearchOutput(bytes(output))).toEqual([
      { column: 9, line: 2, path: "src/a.ts", text: "  const needle = 1" },
      { column: 8, line: 10, path: "src/b.ts", text: "return needle" },
    ]);
  });

  test("keeps colons and other delimiters inside the matched text", () => {
    expect(parseSearchOutput(bytes("a.ts\x005\x0013\x00const url = `http://x`\n"))).toEqual([
      { column: 13, line: 5, path: "a.ts", text: "const url = `http://x`" },
    ]);
  });

  test("converts the byte column to UTF-16 units on a non-ASCII line", () => {
    // "héllo — needle": git reports the byte offset of "needle"; é is 2 bytes
    // And the em dash 3 in UTF-8, but each is 1 UTF-16 unit.
    const text = "héllo — needle";
    const byteColumn = Buffer.from("héllo — ", "utf8").length + 1;
    expect(parseSearchOutput(bytes(`a.ts\x001\x00${byteColumn}\x00${text}\n`))).toEqual([
      { column: 9, line: 1, path: "a.ts", text },
    ]);
  });

  test("stays byte-accurate when the line holds invalid UTF-8 before the match", () => {
    // "caf\xE9 needle" in Latin-1: 0xE9 is 1 byte to git grep but decodes to a
    // Replacement char (3 bytes if re-encoded), which must not skew the column.
    const record = Buffer.concat([
      Buffer.from("a.ts\x001\x006\x00", "utf8"),
      Buffer.from("caf", "utf8"),
      Buffer.from([233]),
      Buffer.from(" needle\n", "utf8"),
    ]);
    expect(parseSearchOutput(record)).toEqual([
      { column: 6, line: 1, path: "a.ts", text: "caf� needle" },
    ]);
  });

  test("drops malformed records", () => {
    expect(parseSearchOutput(bytes("a.ts\x005\x00no column here\n"))).toEqual([]);
    expect(parseSearchOutput(bytes("garbage\n"))).toEqual([]);
  });

  test("empty output yields no matches", () => {
    expect(parseSearchOutput(bytes(""))).toEqual([]);
  });
});

const runSearch = (
  repo: string,
  query: string,
  paths: readonly string[] | undefined,
  options = literal,
) =>
  Effect.runPromise(
    Git.pipe(
      Effect.flatMap((git) => git.search(repo, query, paths, options)),
      Effect.provide(GitLive.pipe(Layer.provide(ProcessLive))),
    ),
  );

test("Git.search finds tracked and untracked content repo-wide", async () => {
  const repo = createFixtureRepo("git-search-repo-", { "src/a.ts": "const needle = 1\n" });
  try {
    writeFileSync(join(repo, "src", "b.ts"), "return needle\n");

    const matches = await runSearch(repo, "needle", undefined);

    expect(matches.map((match) => match.path).toSorted()).toEqual(["src/a.ts", "src/b.ts"]);
    expect(matches.every((match) => match.column > 0)).toBe(true);
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});

test("Git.search limits to the changed pathspec and is smart-case", async () => {
  const repo = createFixtureRepo("git-search-scope-", {
    "src/a.ts": "const needle = 1\n",
    "src/c.ts": "const needle = 2\n",
  });
  try {
    const changed = await runSearch(repo, "needle", ["src/a.ts"]);
    expect(changed.map((match) => match.path)).toEqual(["src/a.ts"]);

    const cased = await runSearch(repo, "NEEDLE", undefined);
    expect(cased).toEqual([]);
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});

test("Git.search subtracts exclude pathspecs, including an exclude-only list", async () => {
  const repo = createFixtureRepo("git-search-exclude-", {
    "src/a.test.ts": "const needle = 1\n",
    "src/a.ts": "const needle = 2\n",
  });
  try {
    const mixed = await runSearch(repo, "needle", ["src/", ":(exclude)*.test.ts"]);
    expect(mixed.map((match) => match.path)).toEqual(["src/a.ts"]);

    const excludeOnly = await runSearch(repo, "needle", [":(exclude)*.test.ts"]);
    expect(excludeOnly.map((match) => match.path)).toEqual(["src/a.ts"]);
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});

test("Git.search matches extended regex when the toggle is on", async () => {
  const repo = createFixtureRepo("git-search-regex-", {
    "src/a.ts": "const needle = 1\nconst noodle = 2\n",
  });
  try {
    const matches = await runSearch(repo, "n(ee|oo)dle", undefined, {
      caseSensitive: false,
      regex: true,
    });
    expect(matches.map((match) => match.line)).toEqual([1, 2]);
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});
