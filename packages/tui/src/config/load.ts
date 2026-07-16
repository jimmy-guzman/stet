import { Result, Schema } from "effect";

import { emptyConfig, UserConfigSchema } from "./schema";
import type { UserConfig } from "./schema";

// Issues never block startup: a malformed or invalid config falls back to
// Defaults and the issues surface as a notice.
export interface LoadedConfig {
  config: UserConfig;
  issues: string[];
}

const decode = Schema.decodeUnknownResult(UserConfigSchema);

const knownKeys = new Set(Object.keys(UserConfigSchema.fields));

// Where the config restructure moved a key, the unknown-key report names the
// Destination instead of calling the old key a typo.
const movedKeys = new Map([["servers", `"servers" moved to "diagnostics.servers"`]]);
const movedSectionKeys = new Map([["icons", `glyph overrides moved to "icons.glyphs"`]]);

// Bun.JSONC.parse throws; a Result lets the parse and decode failures compose.
// The annotation unifies the two branches' Result types for the pipe below.
function parseJsonc(text: string): Result.Result<unknown, string> {
  try {
    return Result.succeed(Bun.JSONC.parse(text));
  } catch (error) {
    return Result.fail(
      `config is not valid JSONC: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// One line (the status notice renders one), without the SchemaError() wrapper.
function formatIssue(error: unknown) {
  const text = String(error).replaceAll(/\s+/g, " ");
  return /^SchemaError\((?<detail>.*)\)$/.exec(text)?.groups?.detail ?? text;
}

// The decode strips unknown keys inside a typed section, so diffing the raw
// Keys against the kept ones reports them; a raw registry (servers, glyphs,
// Themes...) decodes verbatim, diffs empty, and stays its resolver's job.
function unknownSectionKeys(section: string, rawValue: unknown, decodedValue: unknown) {
  if (!isRecord(rawValue) || !isRecord(decodedValue)) {
    return [];
  }
  const kept = new Set(Object.keys(decodedValue));
  const hint = movedSectionKeys.get(section);
  return Object.keys(rawValue)
    .filter((key) => !kept.has(key))
    .map(
      (key) => `config ${section}: unknown key "${key}"${hint === undefined ? "" : ` (${hint})`}`,
    );
}

/**
 * Each top-level key decodes on its own (every schema key is optional, so a one-key object is a
 * valid decode input): a bad value costs only its own section instead of resetting the whole
 * config, and a typo'd key is reported rather than silently stripped, which is what `Schema.Struct`
 * does alone.
 */
export function loadConfigText(text: string): LoadedConfig {
  return parseJsonc(text).pipe(
    Result.match({
      onFailure: (error) => ({ config: emptyConfig, issues: [error] }),
      onSuccess: (raw) => decodeConfig(raw),
    }),
  );
}

function decodeConfig(raw: unknown): LoadedConfig {
  if (!isRecord(raw)) {
    return { config: emptyConfig, issues: ["config must be a JSONC object"] };
  }
  const issues = Object.keys(raw)
    .filter((key) => !knownKeys.has(key))
    .map((key) => `config: ${movedKeys.get(key) ?? `unknown key "${key}"`}`);
  const config = Object.keys(raw)
    .filter((key) => knownKeys.has(key))
    .reduce<UserConfig>(
      (acc, key) =>
        decode({ [key]: raw[key] }).pipe(
          Result.match({
            onFailure: (error) => {
              issues.push(formatIssue(error));
              return acc;
            },
            onSuccess: (part) => {
              issues.push(...unknownSectionKeys(key, raw[key], Object.values(part)[0]));
              return { ...acc, ...part };
            },
          }),
        ),
      emptyConfig,
    );
  return { config, issues };
}
