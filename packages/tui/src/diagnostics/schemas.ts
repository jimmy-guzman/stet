/**
 * File-match pattern -> JSON Schema URI(s), the association map stet hands the language servers.
 * The JSON server ships no schema catalog and never pulls `workspace/configuration`, so an
 * association reaches it only through the `json/schemaAssociations` notification the client sends;
 * the YAML server also validates well-known files through its own SchemaStore integration, so it
 * needs no associations for those. User associations are delivered to both, matched by file
 * pattern.
 */
import { pathToFileURL } from "node:url";

/** Curated well-known JSON files, canonical form pattern -> URIs. The `schemas` config extends it. */
export const builtinSchemas: Record<string, readonly string[]> = {
  "jsconfig.json": ["https://json.schemastore.org/jsconfig.json"],
  "package.json": ["https://json.schemastore.org/package.json"],
  "tsconfig.*.json": ["https://json.schemastore.org/tsconfig.json"],
  "tsconfig.json": ["https://json.schemastore.org/tsconfig.json"],
};

/**
 * Resolve one config value to a schema URI. An `http(s)`/`file` URI passes through; an absolute
 * path becomes a proper `file://` URI (percent-encoded); a relative or bare path becomes a
 * `{repoUri}` URI, resolved per repo at handshake time. `{repoUri}` (not `{repoRoot}`) so a repo
 * path with a space or non-ASCII character is percent-encoded, the way every other per-repo URI
 * substitution is.
 */
function schemaUri(value: string) {
  if (/^(?:https?|file):/.test(value)) {
    return value;
  }
  if (value.startsWith("/")) {
    return pathToFileURL(value).href;
  }
  return `{repoUri}/${value.replace(/^\.\/+/, "")}`;
}

/**
 * Merge the user `schemas` config over the built-in map: a URL or list of URLs associates a
 * file-match pattern with schema(s), `false` disables a built-in. `schemas` is the full merged map
 * (built-ins plus user entries) for the JSON server; `userSchemas` is only the user-defined
 * entries, for the YAML server (its built-in SchemaStore already covers well-known files).
 *
 * @returns The two maps plus one issue per malformed entry (the entry is skipped, its built-in
 *   kept).
 */
export function resolveSchemas(raw: Record<string, unknown>) {
  const issues: string[] = [];
  const schemas: Record<string, readonly string[]> = { ...builtinSchemas };
  const userSchemas: Record<string, readonly string[]> = {};
  for (const [pattern, value] of Object.entries(raw)) {
    if (value === false) {
      delete schemas[pattern];
      continue;
    }
    const uris =
      typeof value === "string"
        ? [value]
        : Array.isArray(value)
          ? value.filter((item): item is string => typeof item === "string")
          : undefined;
    if (
      uris === undefined ||
      uris.length === 0 ||
      (Array.isArray(value) && uris.length !== value.length) ||
      uris.some((uri) => uri.trim() === "")
    ) {
      issues.push(`schema "${pattern}": must be a schema URL, a non-empty list of URLs, or false`);
      continue;
    }
    const resolved = uris.map(schemaUri);
    schemas[pattern] = resolved;
    userSchemas[pattern] = resolved;
  }
  return { issues, schemas, userSchemas };
}

/**
 * The `yaml` server's `settings` answer: its own SchemaStore integration plus any user
 * associations, which it takes inverted (schema URI -> file-match pattern(s)). Built-in JSON
 * schemas are omitted (they are JSON-file patterns the YAML server would never match) so the answer
 * stays user-defined.
 */
export function yamlSchemaSettings(userSchemas: Record<string, readonly string[]>) {
  const byUri = Object.groupBy(
    Object.entries(userSchemas).flatMap(([pattern, uris]) => uris.map((uri) => ({ pattern, uri }))),
    (entry) => entry.uri,
  );
  const schemas = Object.fromEntries(
    Object.entries(byUri).map(([uri, entries]) => [uri, (entries ?? []).map((e) => e.pattern)]),
  );
  return {
    schemaStore: { enable: true },
    validate: true,
    ...(Object.keys(schemas).length === 0 ? {} : { schemas }),
  };
}
