import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pythonTypeChecker } from "@/diagnostics/python";

function repoWith(files: Record<string, string>) {
  const repo = mkdtempSync(join(tmpdir(), "stet-pytype-"));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(repo, name), content);
  }
  return repo;
}

function check(files: Record<string, string>) {
  const repo = repoWith(files);
  try {
    return pythonTypeChecker(repo);
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
}

test("a repo with no ty signal gets the default type checker", () => {
  expect(check({})).toBe("basedpyright");
  expect(check({ "pyproject.toml": '[project]\nname = "app"\ndependencies = ["httpx"]\n' })).toBe(
    "basedpyright",
  );
  // A pyright/basedpyright config is not a ty signal, and neither is an unrelated tool table.
  expect(check({ "pyproject.toml": "[tool.ruff]\nline-length = 100\n" })).toBe("basedpyright");
});

test("a ty config file opts the repo into ty", () => {
  expect(check({ "ty.toml": '[rules]\nunresolved-import = "ignore"\n' })).toBe("ty");
  expect(check({ ".ty.toml": "" })).toBe("ty");
  expect(check({ "pyproject.toml": '[tool.ty.rules]\nunresolved-import = "ignore"\n' })).toBe("ty");
});

test("ty declared as a dependency opts the repo in, wherever it is declared", () => {
  // The common case the panel gets wrong today: ty configured nowhere, just installed and run in CI.
  expect(check({ "pyproject.toml": '[dependency-groups]\ndev = ["ty>=0.0.58"]\n' })).toBe("ty");
  expect(check({ "pyproject.toml": '[tool.uv]\ndev-dependencies = ["ty"]\n' })).toBe("ty");
  expect(
    check({ "pyproject.toml": '[project.optional-dependencies]\nlint = ["ty==0.0.58"]\n' }),
  ).toBe("ty");
  expect(
    check({ "pyproject.toml": "[project]\ndependencies = [\"ty ; python_version >= '3.9'\"]\n" }),
  ).toBe("ty");
});

test("a dependency named ty is matched by its distribution name alone", () => {
  // PEP 503 normalization, so a differently-cased or punctuated spelling still matches.
  expect(check({ "pyproject.toml": '[dependency-groups]\ndev = ["Ty"]\n' })).toBe("ty");
  // A distinct package whose name merely starts with "ty" is not ty.
  expect(
    check({
      "pyproject.toml": '[dependency-groups]\ndev = ["typing-extensions", "types-requests"]\n',
    }),
  ).toBe("basedpyright");
  // An `{ include-group }` entry names no distribution and must not throw the group scan off.
  expect(
    check({
      "pyproject.toml":
        '[dependency-groups]\ntest = ["pytest"]\ndev = [{ include-group = "test" }]\n',
    }),
  ).toBe("basedpyright");
});

test("a malformed pyproject leaves the repo on the default checker", () => {
  // The gate is evaluated on every refresh tick, so a broken file degrades rather than throwing.
  expect(check({ "pyproject.toml": "[project\nname = " })).toBe("basedpyright");
});
