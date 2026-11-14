import { Predicate, Result, Schema } from "effect";
import { createScanner, ScanError, SyntaxKind } from "jsonc-parser";

import { emptyConfig, UserConfigSchema } from "./schema";
import type { UserConfig } from "./schema";

// Issues never block startup: a malformed or invalid config falls back to
// Defaults and the issues surface as a notice.
export interface LoadedConfig {
  config: UserConfig;
  issues: string[];
}

const decode = Schema.decodeUnknownResult(UserConfigSchema);

const decodeObject = Schema.decodeUnknownOption(Schema.JsonObject);

const knownKeys = new Set(Object.keys(UserConfigSchema.fields));

// Where the config restructure moved a key, the unknown-key report names the
// Destination instead of calling the old key a typo.
const movedSectionKeys = new Map([
  ["icons", `glyph overrides moved to "icons.glyphs"`],
]);

const trivia = new Set([
  SyntaxKind.Trivia,
  SyntaxKind.LineBreakTrivia,
  SyntaxKind.LineCommentTrivia,
  SyntaxKind.BlockCommentTrivia,
]);

/**
 * Whether a JSONC document holds no value at all: empty, whitespace, or comments only. Such a file
 * means defaults on load and a fresh object on save, where `Bun.JSONC.parse` rejects it instead.
 * Trivia is walked rather than skipped because the scanner drops an unterminated block comment's
 * error on its way to EOF, and that document is malformed, not empty.
 */
export const isEmptyJsonc = (text: string) => {
  const scanner = createScanner(text, false);

  for (
    let kind = scanner.scan();
    kind !== SyntaxKind.EOF;
    kind = scanner.scan()
  ) {
    if (!trivia.has(kind) || scanner.getTokenError() !== ScanError.None) {
      return false;
    }
  }

  return true;
};

/**
 * Parses as a `Result` so the parse and decode failures compose in the pipe below; the annotation
 * unifies the two branches' Result types.
 */
const parseJsonc = (text: string): Result.Result<unknown, string> => {
  try {
    return Result.succeed(isEmptyJsonc(text) ? {} : Bun.JSONC.parse(text));
  } catch (error) {
    return Result.fail(
      `config is not valid JSONC: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

// One line (the status notice renders one), without the SchemaError() wrapper.
const formatIssue = (error: Schema.SchemaError) => {
  const text = String(error).replaceAll(/\s+/gu, " ");

  return /^SchemaError\((?<detail>.*)\)$/u.exec(text)?.groups?.detail ?? text;
};

// The decode strips unknown keys inside a typed section, so diffing the raw
// Keys against the kept ones reports them; a raw registry (glyphs, themes,
// Files...) decodes verbatim, diffs empty, and stays its resolver's job.
const unknownSectionKeys = (
  section: string,
  rawValue: Schema.Json,
  decoded: UserConfig
) => {
  const [decodedValue] = Object.values(decoded);

  if (!Predicate.isObject(rawValue) || !Predicate.isObject(decodedValue)) {
    return [];
  }

  const kept = new Set(Object.keys(decodedValue));
  const hint = movedSectionKeys.get(section);

  return Object.keys(rawValue)
    .filter((key) => !kept.has(key))
    .map(
      (key) =>
        `config ${section}: unknown key "${key}"${hint === undefined ? "" : ` (${hint})`}`
    );
};

/**
 * Each top-level key decodes on its own (every schema key is optional, so a one-key object is a
 * valid decode input): a bad value costs only its own section instead of resetting the whole
 * config, and a typo'd key is reported rather than silently stripped, which is what `Schema.Struct`
 * does alone.
 */
export const loadConfigText = (text: string): LoadedConfig =>
  parseJsonc(text).pipe(
    Result.flatMap((raw) =>
      decodeObject(raw).pipe(
        Result.fromOption(() => "config must be a JSONC object")
      )
    ),
    Result.match({
      onFailure: (error) => ({ config: emptyConfig, issues: [error] }),
      onSuccess: (raw) => decodeConfig(raw),
    })
  );

const decodeConfig = (raw: Schema.JsonObject): LoadedConfig => {
  const issues = Object.keys(raw)
    .filter((key) => !knownKeys.has(key))
    .map((key) => `config: unknown key "${key}"`);

  let config: UserConfig = emptyConfig;

  for (const key of Object.keys(raw).filter((name) => knownKeys.has(name))) {
    const acc = config;
    config = decode({ [key]: raw[key] }).pipe(
      Result.match({
        onFailure: (error) => {
          issues.push(formatIssue(error));

          return acc;
        },
        onSuccess: (part) => {
          issues.push(...unknownSectionKeys(key, raw[key], part));

          return { ...acc, ...part };
        },
      })
    );
  }

  return { config, issues };
};
