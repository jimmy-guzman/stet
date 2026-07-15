import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { evaluateWhen, parseWhen } from "@/diagnostics/when";

test("when paths resolve from the repo root, including parent markers", async () => {
  const root = mkdtempSync(join(tmpdir(), "stet-when-"));
  const repo = join(root, "repo");
  mkdirSync(join(repo, "config"), { recursive: true });
  writeFileSync(join(repo, "config", "tool.json"), "{}");
  writeFileSync(join(root, "workspace.json"), '{"tool":{"shared":true}}');
  try {
    expect(await evaluateWhen(["missing.json", "config/tool.json"], repo)).toBe(true);
    expect(await evaluateWhen("../workspace.json", repo)).toBe(true);
    expect(await evaluateWhen({ file: "../workspace.json", key: ["tool", "shared"] }, repo)).toBe(
      true,
    );
    expect(parseWhen("../workspace.json")).toEqual({
      issues: [],
      when: ["../workspace.json"],
    });
    expect(parseWhen({ file: "../workspace.json", key: ["tool", "shared"] }).issues).toEqual([]);
    expect(parseWhen(join(root, "workspace.json")).when).toBeUndefined();
    expect(parseWhen({ file: join(root, "workspace.json"), key: ["tool"] }).when).toBeUndefined();
    expect(parseWhen([]).when).toBeUndefined();
  } finally {
    rmSync(root, { force: true, recursive: true });
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
      "[tool.poetry.dev-dependencies]",
      'basedpyright = "^1.0"',
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
    expect(await evaluateWhen({ dependency: "basedpyright", file: "pyproject.toml" }, repo)).toBe(
      true,
    );
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

test("invalid filesystem paths reject their conditions without throwing", async () => {
  const repo = mkdtempSync(join(tmpdir(), "stet-when-"));
  try {
    expect(await evaluateWhen("bad\0path", repo)).toBe(false);
    expect(await evaluateWhen({ file: "bad\0path", key: ["tool", "ty"] }, repo)).toBe(false);
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
  expect(parseWhen("bad\0path").issues).toContain("a when path must not contain a null byte");
  expect(parseWhen([{ file: "bad\0path", key: ["tool"] }]).issues).toContain(
    "a when file must not contain a null byte",
  );
});
