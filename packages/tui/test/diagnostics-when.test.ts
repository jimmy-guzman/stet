import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { evaluateWhen, parseWhen } from "@/diagnostics/when";

test("when paths are repo-bound and arrays are alternatives", async () => {
  const repo = mkdtempSync(join(tmpdir(), "stet-when-"));
  mkdirSync(join(repo, "config"));
  writeFileSync(join(repo, "config", "tool.json"), "{}");
  try {
    expect(await evaluateWhen(["missing.json", "config/tool.json"], repo)).toBe(true);
    expect(parseWhen("../outside").when).toBeUndefined();
    expect(parseWhen([]).when).toBeUndefined();
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});

test("when reads manifest keys and Python dependency declarations", async () => {
  const repo = mkdtempSync(join(tmpdir(), "stet-when-"));
  writeFileSync(
    join(repo, "pyproject.toml"),
    [
      "[project]",
      'dependencies = ["Django>=5"]',
      "[project.optional-dependencies]",
      'dev = ["pytest>=8"]',
      "[dependency-groups]",
      'dev = ["ty>=0.0.58"]',
      "[tool.uv]",
      'dev-dependencies = ["mypy"]',
      "[tool.poetry.group.lint.dependencies]",
      'ruff = "^0.15"',
      "[tool.ty]",
      'python = ".venv"',
    ].join("\n"),
  );
  try {
    expect(await evaluateWhen({ file: "pyproject.toml", key: ["tool", "ty"] }, repo)).toBe(true);
    expect(await evaluateWhen({ dependency: "django", file: "pyproject.toml" }, repo)).toBe(true);
    expect(await evaluateWhen({ dependency: "PyTest", file: "pyproject.toml" }, repo)).toBe(true);
    expect(await evaluateWhen({ dependency: "ruff", file: "pyproject.toml" }, repo)).toBe(true);
    expect(await evaluateWhen({ dependency: "ty", file: "pyproject.toml" }, repo)).toBe(true);
    expect(await evaluateWhen({ dependency: "mypy", file: "pyproject.toml" }, repo)).toBe(true);
    expect(
      await evaluateWhen({ dependency: "typing-extensions", file: "pyproject.toml" }, repo),
    ).toBe(false);
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});

test("a missing or malformed manifest rejects its conditions without throwing", async () => {
  const repo = mkdtempSync(join(tmpdir(), "stet-when-"));
  writeFileSync(join(repo, "pyproject.toml"), "[project\nname = ");
  try {
    expect(await evaluateWhen({ file: "pyproject.toml", key: ["tool", "ty"] }, repo)).toBe(false);
    expect(await evaluateWhen({ dependency: "ty", file: "pyproject.toml" }, repo)).toBe(false);
    expect(await evaluateWhen({ file: "missing.json", key: ["tool"] }, repo)).toBe(false);
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});

test("parseWhen validates every condition shape", () => {
  expect(parseWhen(["biome.json"]).issues).toEqual([]);
  expect(parseWhen([{ file: "pyproject.toml", key: ["tool", "ty"] }]).issues).toEqual([]);
  expect(parseWhen([{ dependency: "ty", file: "pyproject.toml" }]).issues).toEqual([]);
  expect(parseWhen([]).issues).toEqual(["when must not be empty"]);
  expect(parseWhen([42]).issues).toContain(
    "a when condition must be a path or an object with file + key/dependency",
  );
  expect(parseWhen([{ file: "x.toml" }]).issues).toContain(
    "a when condition needs exactly one of key or dependency",
  );
  expect(parseWhen([{ dependency: "serde", file: "Cargo.toml" }]).issues).toContain(
    'a when dependency is only supported in "pyproject.toml"',
  );
  expect(parseWhen([{ file: "x.toml", frobnicate: true, key: ["a"] }]).issues).toContain(
    'unknown when field "frobnicate"',
  );
});
