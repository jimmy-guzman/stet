/**
 * Which type checker a Python repo uses. Unlike TypeScript, Python has several competing ones, so
 * the checker is a project choice rather than a language fact: basedpyright is the default, and a
 * repo that opted into ty gets ty instead, exactly as its own CI does. One decision function, so
 * the two registry `detect` gates are views of a single answer and can never drift into running
 * both (duplicate, differently-worded type errors) or neither.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function pythonTypeChecker(repoRoot: string): "basedpyright" | "ty" {
  return usesTy(repoRoot) ? "ty" : "basedpyright";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A dedicated ty config is the clearest opt-in, but ty is routinely used with no config at all
// (`uv add --dev ty`, then `uv run ty check` in CI), so a declared dependency counts too. Without
// That, the repos this exists for would keep seeing basedpyright's findings.
function usesTy(repoRoot: string) {
  if (existsSync(join(repoRoot, "ty.toml")) || existsSync(join(repoRoot, ".ty.toml"))) {
    return true;
  }
  const pyproject = readPyproject(join(repoRoot, "pyproject.toml"));
  if (pyproject === undefined) {
    return false;
  }
  const tool = isRecord(pyproject.tool) ? pyproject.tool : {};
  return tool.ty !== undefined || declaredDependencies(pyproject).includes("ty");
}

/**
 * The parsed pyproject, or undefined when it is absent or malformed: a broken file leaves the repo
 * on the default checker rather than throwing into the refresh tick that evaluates this gate.
 */
function readPyproject(path: string) {
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const parsed = Bun.TOML.parse(readFileSync(path, "utf8"));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Every requirement list a pyproject can declare: runtime, extras, dependency groups, uv's own. */
function declaredDependencies(pyproject: Record<string, unknown>) {
  const project = isRecord(pyproject.project) ? pyproject.project : {};
  const tool = isRecord(pyproject.tool) ? pyproject.tool : {};
  const uv = isRecord(tool.uv) ? tool.uv : {};
  const groups = [pyproject["dependency-groups"], project["optional-dependencies"]]
    .filter(isRecord)
    .flatMap((record) => Object.values(record));
  return [project.dependencies, uv["dev-dependencies"], ...groups].flatMap(requirementNames);
}

/**
 * The distribution names in a PEP 508 requirement list, normalized per PEP 503 so `Ty` and `t_y`
 * match the pinned name.
 */
function requirementNames(list: unknown) {
  if (!Array.isArray(list)) {
    return [];
  }
  return (
    list
      // A `[dependency-groups]` entry can be an `{ include-group = "..." }` table instead of a
      // Requirement string; it names no distribution.
      .filter((entry): entry is string => typeof entry === "string")
      .flatMap((entry) => {
        const name = /^[A-Za-z0-9._-]+/.exec(entry.trim())?.[0];
        return name === undefined ? [] : [name.toLowerCase().replaceAll(/[-_.]+/g, "-")];
      })
  );
}
