import { expect, test } from "bun:test";

import { builtinSchemas, resolveSchemas, yamlSchemaSettings } from "@/diagnostics/schemas";

test("resolveSchemas keeps the built-in associations when the config is empty", () => {
  const { issues, schemas } = resolveSchemas({});
  expect(issues).toEqual([]);
  expect(schemas["package.json"]).toEqual(["https://json.schemastore.org/package.json"]);
  expect(schemas["tsconfig.json"]).toEqual(["https://json.schemastore.org/tsconfig.json"]);
});

test("a user entry adds a new association and can supply a list of schemas", () => {
  const { issues, schemas } = resolveSchemas({
    "*.knative.yaml": "https://example.com/knative.json",
    "values.yaml": ["https://example.com/a.json", "https://example.com/b.json"],
  });
  expect(issues).toEqual([]);
  expect(schemas["*.knative.yaml"]).toEqual(["https://example.com/knative.json"]);
  expect(schemas["values.yaml"]).toEqual([
    "https://example.com/a.json",
    "https://example.com/b.json",
  ]);
  // Built-ins survive alongside the additions.
  expect(schemas["package.json"]).toEqual(["https://json.schemastore.org/package.json"]);
});

test("a user entry overrides a built-in and false disables one", () => {
  const { issues, schemas } = resolveSchemas({
    "package.json": "https://example.com/pkg.json",
    "tsconfig.json": false,
  });
  expect(issues).toEqual([]);
  expect(schemas["package.json"]).toEqual(["https://example.com/pkg.json"]);
  expect(schemas["tsconfig.json"]).toBeUndefined();
});

test("a relative path resolves to a per-repo URI, an absolute path to an absolute file URI", () => {
  const { issues, schemas } = resolveSchemas({
    "a.json": "./schemas/a.json",
    "b.json": "schemas/b.json",
    "c.json": "/etc/schemas/c.json",
  });
  expect(issues).toEqual([]);
  // {repoUri} is the percent-encoded repo URI, substituted per repo at handshake time.
  expect(schemas["a.json"]).toEqual(["{repoUri}/schemas/a.json"]);
  expect(schemas["b.json"]).toEqual(["{repoUri}/schemas/b.json"]);
  // An absolute path is its own file URI, not rerooted under the repo.
  expect(schemas["c.json"]).toEqual(["file:///etc/schemas/c.json"]);
});

test("a malformed or empty value is reported and its built-in is retained", () => {
  const { issues, schemas } = resolveSchemas({
    "empty.json": "",
    "mixed.json": ["https://example.com/a.json", 7],
    "new.json": true,
    "package.json": 5,
  });
  expect(issues).toHaveLength(4);
  expect(issues.every((issue) => /must be a schema URL/.test(issue))).toBe(true);
  // The built-in override was invalid, so the built-in stays; the invalid new entries never land.
  expect(schemas["package.json"]).toEqual(builtinSchemas["package.json"]);
  expect(schemas["new.json"]).toBeUndefined();
  expect(schemas["mixed.json"]).toBeUndefined();
  expect(schemas["empty.json"]).toBeUndefined();
});

test("userSchemas carries only user entries, and yamlSchemaSettings inverts them", () => {
  const { userSchemas } = resolveSchemas({
    "*.knative.yaml": "https://example.com/knative.json",
    "package.json": false,
  });
  // A built-in is not a user entry, and a disabled built-in is not one either.
  expect(Object.keys(userSchemas)).toEqual(["*.knative.yaml"]);

  // The yaml server takes associations inverted: schema URI -> file-match pattern(s).
  expect(yamlSchemaSettings(userSchemas)).toEqual({
    schemaStore: { enable: true },
    schemas: { "https://example.com/knative.json": ["*.knative.yaml"] },
    validate: true,
  });
});

test("yamlSchemaSettings omits schemas when there are no user associations", () => {
  expect(yamlSchemaSettings({})).toEqual({ schemaStore: { enable: true }, validate: true });
});
