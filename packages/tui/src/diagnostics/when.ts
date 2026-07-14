import { isAbsolute, relative, resolve, sep } from "node:path";

type WhenCondition =
  | string
  | { readonly file: string; readonly key: readonly string[] }
  | { readonly dependency: string; readonly file: "pyproject.toml" };

export type When = WhenCondition | readonly WhenCondition[];
export type ManifestCache = Map<string, Promise<Record<string, unknown> | undefined>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function conditionList(when: When): readonly WhenCondition[] {
  return isConditionList(when) ? when : [when];
}

function isConditionList(when: When): when is readonly WhenCondition[] {
  return Array.isArray(when);
}

function pathInsideRepo(repoRoot: string, file: string) {
  if (isAbsolute(file)) {
    return undefined;
  }
  const path = resolve(repoRoot, file);
  const fromRoot = relative(repoRoot, path);
  return fromRoot === "" || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== "..")
    ? path
    : undefined;
}

function parseManifest(path: string) {
  return Bun.file(path)
    .text()
    .then((text) => {
      const parsed = path.endsWith(".toml") ? Bun.TOML.parse(text) : Bun.JSONC.parse(text);
      return isRecord(parsed) ? parsed : undefined;
    })
    .catch(() => undefined);
}

function readManifest(file: string, repoRoot: string, manifests: ManifestCache) {
  const existing = manifests.get(file);
  if (existing !== undefined) {
    return existing;
  }
  const path = pathInsideRepo(repoRoot, file);
  const manifest = path === undefined ? Promise.resolve(undefined) : parseManifest(path);
  manifests.set(file, manifest);
  return manifest;
}

function normalizeDistributionName(name: string) {
  return name.toLowerCase().replaceAll(/[-_.]+/g, "-");
}

function requirementNames(value: unknown) {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .flatMap((entry) => {
          const name = /^[A-Za-z0-9._-]+/.exec(entry.trim())?.[0];
          return name === undefined ? [] : [normalizeDistributionName(name)];
        })
    : [];
}

function recordKeys(value: unknown) {
  return isRecord(value) ? Object.keys(value).map(normalizeDistributionName) : [];
}

function declaredDependencies(pyproject: Record<string, unknown>) {
  const project = isRecord(pyproject.project) ? pyproject.project : {};
  const tool = isRecord(pyproject.tool) ? pyproject.tool : {};
  const uv = isRecord(tool.uv) ? tool.uv : {};
  const poetry = isRecord(tool.poetry) ? tool.poetry : {};
  const poetryGroups = isRecord(poetry.group)
    ? Object.values(poetry.group).flatMap((group) =>
        isRecord(group) ? recordKeys(group.dependencies) : [],
      )
    : [];
  const requirementGroups = [pyproject["dependency-groups"], project["optional-dependencies"]]
    .filter(isRecord)
    .flatMap((group) => Object.values(group).flatMap(requirementNames));
  return new Set([
    ...requirementNames(project.dependencies),
    ...requirementNames(uv["dev-dependencies"]),
    ...requirementGroups,
    ...recordKeys(poetry.dependencies),
    ...poetryGroups,
  ]);
}

async function evaluateCondition(
  condition: WhenCondition,
  repoRoot: string,
  manifests: ManifestCache,
) {
  if (typeof condition === "string") {
    const path = pathInsideRepo(repoRoot, condition);
    return path === undefined ? false : Bun.file(path).exists();
  }
  const manifest = await readManifest(condition.file, repoRoot, manifests);
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
  return declaredDependencies(manifest).has(normalizeDistributionName(condition.dependency));
}

/** Evaluate one declarative repo gate. Conditions in an array are any-of alternatives. */
export async function evaluateWhen(
  when: When,
  repoRoot: string,
  manifests: ManifestCache = new Map(),
) {
  const results = await Promise.all(
    conditionList(when).map((condition) => evaluateCondition(condition, repoRoot, manifests)),
  );
  return results.some(Boolean);
}

/** Validate config data into the gate grammar without allowing filesystem escape paths. */
export function parseWhen(value: unknown): { issues: string[]; when?: When } {
  const raw = Array.isArray(value) ? value : [value];
  if (raw.length === 0) {
    return { issues: ["when must not be empty"] };
  }
  const issues: string[] = [];
  const conditions = raw.flatMap((entry): WhenCondition[] => {
    if (typeof entry === "string") {
      if (entry === "" || isAbsolute(entry) || entry.split("/").includes("..")) {
        issues.push("a when path must stay inside the repository");
        return [];
      }
      return [entry];
    }
    if (!isRecord(entry)) {
      issues.push("a when condition must be a path or an object with file + key/dependency");
      return [];
    }
    const unknown = Object.keys(entry).filter(
      (field) => field !== "file" && field !== "key" && field !== "dependency",
    );
    issues.push(...unknown.map((field) => `unknown when field "${field}"`));
    if (
      typeof entry.file !== "string" ||
      entry.file === "" ||
      isAbsolute(entry.file) ||
      entry.file.split("/").includes("..")
    ) {
      issues.push("a when file must stay inside the repository");
      return [];
    }
    if ("key" in entry === "dependency" in entry) {
      issues.push("a when condition needs exactly one of key or dependency");
      return [];
    }
    if ("dependency" in entry) {
      if (entry.file !== "pyproject.toml") {
        issues.push('a when dependency is only supported in "pyproject.toml"');
        return [];
      }
      if (typeof entry.dependency !== "string" || entry.dependency === "") {
        issues.push("a when dependency must be a package name");
        return [];
      }
      return [{ dependency: entry.dependency, file: entry.file }];
    }
    const key = Array.isArray(entry.key)
      ? entry.key.filter(
          (segment): segment is string => typeof segment === "string" && segment !== "",
        )
      : [];
    if (!Array.isArray(entry.key) || key.length === 0 || key.length !== entry.key.length) {
      issues.push("a when key must be a non-empty array of segments");
      return [];
    }
    return [{ file: entry.file, key }];
  });
  return issues.length > 0 || conditions.length === 0
    ? { issues: issues.length > 0 ? issues : ["when must not be empty"] }
    : { issues: [], when: conditions };
}
