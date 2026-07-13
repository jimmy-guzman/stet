import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { evaluateWhen, parseWhen } from "@/diagnostics/when";
import type { When } from "@/diagnostics/when";

function inRepo(files: Record<string, string>, when: When) {
  const repo = mkdtempSync(join(tmpdir(), "stet-when-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(repo, name), content);
  }
  try {
    return evaluateWhen(when, repo, new Map());
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
}

describe("file conditions", () => {
  test("a bare path matches when it exists at the repo root", () => {
    expect(inRepo({ "biome.json": "{}" }, "biome.json")).toBe(true);
    expect(inRepo({}, "biome.json")).toBe(false);
  });

  test("an array is any-of", () => {
    expect(inRepo({ "biome.jsonc": "{}" }, ["biome.json", "biome.jsonc"])).toBe(true);
    expect(inRepo({}, ["biome.json", "biome.jsonc"])).toBe(false);
  });
});

describe("key conditions", () => {
  test("matches a nested table in a TOML manifest", () => {
    const when: When = { file: "pyproject.toml", key: ["tool", "ty"] };
    expect(
      inRepo({ "pyproject.toml": '[tool.ty.rules]\nunresolved-import = "ignore"\n' }, when),
    ).toBe(true);
    expect(inRepo({ "pyproject.toml": "[tool.ruff]\nline-length = 100\n" }, when)).toBe(false);
    expect(inRepo({}, when)).toBe(false);
  });

  test("matches a key in a JSON manifest, so npm dependencies are reachable", () => {
    const when: When = { file: "package.json", key: ["devDependencies", "@biomejs/biome"] };
    expect(
      inRepo({ "package.json": '{ "devDependencies": { "@biomejs/biome": "2.0.0" } }' }, when),
    ).toBe(true);
    expect(inRepo({ "package.json": '{ "dependencies": {} }' }, when)).toBe(false);
  });

  test("a malformed manifest reads as not met, never a throw", () => {
    // Gates run on refresh ticks; a repo mid-edit degrades, it must not crash a run.
    expect(
      inRepo({ "pyproject.toml": "[project\nname = " }, { file: "pyproject.toml", key: ["tool"] }),
    ).toBe(false);
  });
});

describe("dependency conditions", () => {
  const when: When = { dependency: "ty", file: "pyproject.toml" };

  test("matches wherever a pyproject declares it", () => {
    // The common case the gate exists for: ty configured nowhere, just installed and run in CI.
    expect(inRepo({ "pyproject.toml": '[dependency-groups]\ndev = ["ty>=0.0.58"]\n' }, when)).toBe(
      true,
    );
    expect(inRepo({ "pyproject.toml": '[tool.uv]\ndev-dependencies = ["ty"]\n' }, when)).toBe(true);
    expect(
      inRepo(
        { "pyproject.toml": '[project.optional-dependencies]\nlint = ["ty==0.0.58"]\n' },
        when,
      ),
    ).toBe(true);
    expect(
      inRepo(
        { "pyproject.toml": "[project]\ndependencies = [\"ty ; python_version >= '3.9'\"]\n" },
        when,
      ),
    ).toBe(true);
  });

  test("matches by normalized distribution name only", () => {
    // PEP 503 normalization, so a differently-cased spelling still matches.
    expect(inRepo({ "pyproject.toml": '[dependency-groups]\ndev = ["Ty"]\n' }, when)).toBe(true);
    // A distinct package whose name merely starts with "ty" is not ty.
    expect(
      inRepo(
        {
          "pyproject.toml": '[dependency-groups]\ndev = ["typing-extensions", "types-requests"]\n',
        },
        when,
      ),
    ).toBe(false);
    // An `{ include-group }` entry names no distribution and must not throw the group scan off.
    expect(
      inRepo(
        {
          "pyproject.toml":
            '[dependency-groups]\ntest = ["pytest"]\ndev = [{ include-group = "test" }]\n',
        },
        when,
      ),
    ).toBe(false);
  });

  test("a bare or malformed pyproject is not met", () => {
    expect(inRepo({}, when)).toBe(false);
    expect(inRepo({ "pyproject.toml": "[project\nname = " }, when)).toBe(false);
  });
});

describe("parseWhen", () => {
  test("accepts the grammar and rejects everything else with a reason", () => {
    expect(parseWhen(["biome.json"]).when).toEqual(["biome.json"]);
    expect(parseWhen([{ file: "pyproject.toml", key: ["tool", "ty"] }]).issues).toEqual([]);
    expect(parseWhen([{ dependency: "ty", file: "pyproject.toml" }]).issues).toEqual([]);

    expect(parseWhen([]).issues).toEqual(["when must not be empty"]);
    expect(parseWhen([42]).issues).toContain(
      "a when condition must be a path or an object with file + key/dependency",
    );
    expect(parseWhen([{ key: ["tool"] }]).issues).toContain("a when condition needs a file");
    expect(parseWhen([{ file: "x.toml" }]).issues).toContain(
      "a when condition needs exactly one of key or dependency",
    );
    expect(parseWhen([{ dependency: "ty", file: "x.toml", key: ["a"] }]).issues).toContain(
      "a when condition needs exactly one of key or dependency",
    );
    expect(parseWhen([{ file: "pyproject.toml", key: [] }]).issues).toContain(
      "a when key must be a non-empty array of segments",
    );
    // Requirement-string parsing exists only for pyproject; npm/Cargo dependencies are keys.
    expect(parseWhen([{ dependency: "serde", file: "Cargo.toml" }]).issues).toContain(
      'a when dependency is only supported in "pyproject.toml"',
    );
    expect(parseWhen([{ file: "x.toml", frobnicate: true, key: ["a"] }]).issues).toContain(
      'unknown when field "frobnicate"',
    );
  });
});
