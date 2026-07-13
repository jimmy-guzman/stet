/**
 * The repo-gate grammar shared by the server registry and user config: a `when` says in which repos
 * a server runs, as data. One condition or an any-of list of them; a condition is a path that
 * exists at the repo root, a structured key present in a TOML/JSON(C) manifest, or a declared
 * Python dependency. Gates are data (not predicates) so the built-in table is written in exactly
 * the language a user's config writes, and there is deliberately no code escape hatch: a gate a
 * condition can't express gets a new condition here, which the config then gets for free.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type WhenCondition =
  | string
  | { readonly file: string; readonly key: readonly string[] }
  // The literal matches what `parseWhen` enforces: pyproject is the one manifest whose dependencies
  // Are requirement strings needing name parsing, so a gate pointing `dependency` anywhere else is
  // A type error, not a silently-false condition.
  | { readonly file: "pyproject.toml"; readonly dependency: string };

export type When = WhenCondition | readonly WhenCondition[];

/**
 * Parsed manifests for one evaluation pass, keyed by repo-relative path. Gates are re-evaluated on
 * every refresh tick, and several conditions may read the same manifest (ty's gate reads pyproject
 * twice), so a pass shares one read and parse per file.
 */
export type ManifestCache = Map<string, Record<string, unknown> | undefined>;

// Array.isArray narrows a readonly-array union to `any[]` and leaves the false branch untouched,
// So the guard is spelled out once here instead of a cast at the use site.
function isConditionList(when: When): when is readonly WhenCondition[] {
  return Array.isArray(when);
}

export function evaluateWhen(when: When, repoRoot: string, manifests: ManifestCache): boolean {
  const conditions = isConditionList(when) ? when : [when];
  return conditions.some((condition) => evaluateCondition(condition, repoRoot, manifests));
}

function evaluateCondition(
  condition: WhenCondition,
  repoRoot: string,
  manifests: ManifestCache,
): boolean {
  if (typeof condition === "string") {
    return existsSync(join(repoRoot, condition));
  }
  const manifest = readManifest(condition.file, repoRoot, manifests);
  if (manifest === undefined) {
    return false;
  }
  if ("key" in condition) {
    return (
      condition.key.reduce<unknown>(
        (value, segment) => (isRecord(value) ? value[segment] : undefined),
        manifest,
      ) !== undefined
    );
  }
  return declaredDependencies(manifest).includes(normalizeDistributionName(condition.dependency));
}

// A missing or malformed manifest reads as "condition not met", never a throw: gates are evaluated
// On refresh ticks, and a repo mid-edit must degrade to the ungated default, not crash a run.
function readManifest(file: string, repoRoot: string, manifests: ManifestCache) {
  if (manifests.has(file)) {
    return manifests.get(file);
  }
  const manifest = parseManifest(join(repoRoot, file));
  manifests.set(file, manifest);
  return manifest;
}

function parseManifest(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const text = readFileSync(path, "utf8");
    const parsed = path.endsWith(".toml") ? Bun.TOML.parse(text) : Bun.JSONC.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Every requirement list a pyproject can declare: runtime, extras, dependency groups, uv's own.
 * pyproject is the one manifest whose dependencies are requirement strings needing name parsing;
 * npm and Cargo declare theirs as keys, which the `key` condition already reaches.
 */
function declaredDependencies(pyproject: Record<string, unknown>) {
  const project = isRecord(pyproject.project) ? pyproject.project : {};
  const tool = isRecord(pyproject.tool) ? pyproject.tool : {};
  const uv = isRecord(tool.uv) ? tool.uv : {};
  const groups = [pyproject["dependency-groups"], project["optional-dependencies"]]
    .filter(isRecord)
    .flatMap((record) => Object.values(record));
  return [project.dependencies, uv["dev-dependencies"], ...groups].flatMap(requirementNames);
}

/** The distribution names in a PEP 508 requirement list, normalized per PEP 503. */
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
        return name === undefined ? [] : [normalizeDistributionName(name)];
      })
  );
}

/** PEP 503: lowercase, runs of `-`/`_`/`.` collapse to `-`, so `Ty` and `t_y` match `ty`. */
function normalizeDistributionName(name: string) {
  return name.toLowerCase().replaceAll(/[-_.]+/g, "-");
}

/**
 * Validate a raw config `when` into the grammar, or report why not. Mirrors the resolver style: the
 * caller surfaces `issues` as notices and skips the entry, so a bad gate never sinks the rest of
 * the config.
 */
export function parseWhen(value: unknown): { when?: When; issues: string[] } {
  const raw = Array.isArray(value) ? value : [value];
  if (raw.length === 0) {
    return { issues: ["when must not be empty"] };
  }
  const issues: string[] = [];
  const conditions = raw.flatMap((entry): WhenCondition[] => {
    if (typeof entry === "string" && entry !== "") {
      return [entry];
    }
    if (!isRecord(entry)) {
      issues.push("a when condition must be a path or an object with file + key/dependency");
      return [];
    }
    for (const field of Object.keys(entry)) {
      if (field !== "file" && field !== "key" && field !== "dependency") {
        issues.push(`unknown when field "${field}"`);
      }
    }
    if (typeof entry.file !== "string" || entry.file === "") {
      issues.push("a when condition needs a file");
      return [];
    }
    if ("key" in entry === "dependency" in entry) {
      issues.push("a when condition needs exactly one of key or dependency");
      return [];
    }
    if ("dependency" in entry) {
      if (typeof entry.dependency !== "string" || entry.dependency === "") {
        issues.push("a when dependency must be a package name");
        return [];
      }
      // The one manifest whose dependencies are requirement strings; npm/Cargo deps are keys, so
      // The `key` condition covers them.
      if (entry.file !== "pyproject.toml") {
        issues.push('a when dependency is only supported in "pyproject.toml"');
        return [];
      }
      return [{ dependency: entry.dependency, file: entry.file }];
    }
    const key = Array.isArray(entry.key)
      ? entry.key.filter(
          (segment): segment is string => typeof segment === "string" && segment !== "",
        )
      : [];
    if (key.length === 0 || !Array.isArray(entry.key) || key.length !== entry.key.length) {
      issues.push("a when key must be a non-empty array of segments");
      return [];
    }
    return [{ file: entry.file, key }];
  });
  if (issues.length > 0 || conditions.length === 0) {
    return { issues: issues.length > 0 ? issues : ["when must not be empty"] };
  }
  return { issues: [], when: conditions };
}
