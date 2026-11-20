import path from "node:path";

import { Option, Predicate, Result, Schema } from "effect";

import { isReservedThemeName } from "./registry";
import type { ZedTheme } from "./zed";

const isJsonObject = Schema.is(Schema.JsonObject);

/**
 * One scope's color: a bare color, or a settings object whose `color` stet reads. Zed files write
 * `null` for unset settings, so only `color` is decoded and the rest (font settings a terminal cannot
 * render) is ignored.
 */
const SyntaxColor = Schema.Union([
  Schema.String,
  Schema.Struct({ color: Schema.optionalKey(Schema.NullOr(Schema.String)) }),
]);

/** A Zed theme family file, the format Zed's theme extensions ship. */
const ThemeFile = Schema.Struct({
  themes: Schema.Array(
    Schema.Struct({
      appearance: Schema.Literals(["dark", "light"]),
      name: Schema.String,
      style: Schema.Record(Schema.String, Schema.Json),
    })
  ),
});

const decodeFile = Schema.decodeUnknownResult(ThemeFile);
const decodeSyntaxColor = Schema.decodeUnknownOption(SyntaxColor);

/** `Catppuccin Mocha` -> `catppuccin-mocha`, the form theme names take everywhere else. */
const slug = (name: string) =>
  name
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, "-")
    .replaceAll(/^-|-$/gu, "");

const parseJson = (text: string): Result.Result<unknown, string> => {
  try {
    return Result.succeed(Bun.JSONC.parse(text));
  } catch (error) {
    return Result.fail(error instanceof Error ? error.message : String(error));
  }
};

/** The scopes with a color; a scope this cannot read is skipped, never the whole map. */
const syntaxColors = (syntax: Schema.Json | undefined) =>
  Object.fromEntries(
    Object.entries(isJsonObject(syntax) ? syntax : {}).flatMap(
      ([scope, value]) => {
        const decoded = Option.getOrUndefined(decodeSyntaxColor(value));
        const color = Predicate.isString(decoded) ? decoded : decoded?.color;

        return Predicate.isString(color) ? [[scope, color]] : [];
      }
    )
  );

/**
 * The themes in one Zed theme file, each with the slug of its name, in file order. A list, not a map,
 * so two themes sharing a slug both reach `readUserThemes`, which reports the clash. Only the
 * string colors and `syntax` are kept: that is everything stet derives from and the highlighter
 * reads.
 */
export const parseThemeFile = (text: string) =>
  parseJson(text).pipe(
    Result.flatMap((json) =>
      decodeFile(json).pipe(
        Result.mapError((schemaError) =>
          String(schemaError).replaceAll(/\s+/gu, " ")
        )
      )
    ),
    Result.map(({ themes }) =>
      themes.map(({ appearance, name, style }): [string, ZedTheme] => [
        slug(name),
        {
          appearance,
          name,
          style: {
            ...Object.fromEntries(
              Object.entries(style).filter(([, value]) =>
                Predicate.isString(value)
              )
            ),
            syntax: syntaxColors(style.syntax),
          },
        },
      ])
    )
  );

/** The `*.json` file names in `dir`, unsorted; a missing directory yields none. */
const listThemeFiles = async (dir: string) => {
  try {
    return await Array.fromAsync(
      new Bun.Glob("*.json").scan({ cwd: dir, onlyFiles: true })
    );
  } catch {
    // No themes directory, the common case: no user themes.
    return [];
  }
};

/** One file's themes, or why it could not be read or parsed; never a rejection. */
const readThemeFile = async (dir: string, file: string) => {
  try {
    return parseThemeFile(await Bun.file(path.join(dir, file)).text());
  } catch (error) {
    return Result.fail(error instanceof Error ? error.message : String(error));
  }
};

/**
 * Every theme in the `*.json` files of `dir`, in file-name order, plus one issue per file that cannot
 * be read or is not a Zed theme, and per theme with no usable name, a reserved name
 * (`isReservedThemeName`), or a name an earlier one took (the first keeps it). A missing directory is the common case and yields nothing; nothing
 * here can fail startup.
 */
export const readUserThemes = async (dir: string) => {
  const listed = await listThemeFiles(dir);
  const files = listed.toSorted((a, b) => a.localeCompare(b));

  const parsed = await Promise.all(
    files.map(async (file) => ({
      file,
      result: await readThemeFile(dir, file),
    }))
  );

  const themes = new Map<string, ZedTheme>();
  const issues: string[] = [];

  for (const { file, result } of parsed) {
    if (Result.isSuccess(result)) {
      for (const [name, theme] of result.success) {
        const taken = themes.get(name);

        if (name === "") {
          issues.push(
            `theme file ${file}: theme ${JSON.stringify(theme.name)} has no usable name`
          );
        } else if (isReservedThemeName(name)) {
          issues.push(
            `theme file ${file}: theme ${JSON.stringify(theme.name)} uses the reserved name ${name}`
          );
        } else if (taken === undefined) {
          themes.set(name, theme);
        } else {
          issues.push(
            `theme file ${file}: theme ${JSON.stringify(theme.name)} is listed as ${name}, which ${JSON.stringify(taken.name)} already uses`
          );
        }
      }
    } else {
      issues.push(`theme file ${file}: ${result.failure}`);
    }
  }

  return { issues, themes };
};
