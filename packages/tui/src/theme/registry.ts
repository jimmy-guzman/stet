import { Predicate, Result, Schema } from "effect";
import { bundledThemesInfo } from "shiki/themes";

import { darkTheme } from "./dark";
import { lightTheme } from "./light";
import { isJsonObject, mergeDeep } from "./merge";
import { monoDarkTheme, monoLightTheme } from "./mono";
import { ThemeSchema } from "./tokens";
import type { Theme } from "./tokens";

/**
 * Kept here, not imported from config, so theme/ stays free of a config dependency; the config
 * schema validates the matching shape.
 */
export type ThemeSelection =
  | string
  | { dark: string; light: string }
  | undefined;

/**
 * `syntaxTheme` (set when a theme's `syntax` is a bundled name) sources code colors from that theme;
 * otherwise `tokens.syntax` does. `tokens` always drive the UI.
 */
interface RegisteredTheme {
  tokens: Theme;
  syntaxTheme?: string;
}

const builtins = new Map([
  ["dark", { tokens: darkTheme }],
  ["light", { tokens: lightTheme }],
  ["mono-dark", { tokens: monoDarkTheme }],
  ["mono-light", { tokens: monoLightTheme }],
]);

const registry = new Map<string, RegisteredTheme>(builtins);

const bundledThemeIds = new Set(bundledThemesInfo.map((theme) => theme.id));

export const themeForName = (name: string): Theme =>
  registry.get(name)?.tokens ?? darkTheme;

export const syntaxThemeForName = (name: string) =>
  registry.get(name)?.syntaxTheme;

export const hasTheme = (name: string) => registry.has(name);

/**
 * Built-ins first (`dark`, `light`), then user themes in registration order; `Map` preserves
 * insertion order, which is the order the switcher lists them in.
 */
export const themeNames = () => [...registry.keys()];

/**
 * Test-only: the registry is a process-global map, so the test preload resets it to the built-ins
 * before every test.
 */
export const restoreRegistry = () => {
  registry.clear();

  for (const [name, theme] of builtins) {
    registry.set(name, theme);
  }
};

export const selectThemeName = (
  selection: ThemeSelection,
  appearance: "dark" | "light"
) => {
  if (selection === undefined) {
    return appearance;
  }

  return Predicate.isString(selection) ? selection : selection[appearance];
};

export interface ResolvedThemes {
  themes: Map<string, RegisteredTheme>;
  issues: string[];
}

const decodeTheme = Schema.decodeUnknownResult(ThemeSchema);

/**
 * Resolve raw config theme entries into validated themes, applying `base` merges with cycle
 * detection. Anything wrong (invalid entry, unknown base or syntax theme, cycle) is reported in
 * `issues` rather than thrown, so one bad theme never sinks the rest.
 */
export const resolveThemes = (raw: Schema.JsonObject): ResolvedThemes => {
  const resolved = new Map<string, RegisteredTheme>();
  const failed = new Set<string>();
  const issues: string[] = [];

  const tokensOf = (name: string, candidate: Schema.Json) =>
    Result.match(decodeTheme(candidate), {
      onFailure: (error) => {
        issues.push(`theme "${name}": ${String(error)}`);
      },
      onSuccess: (theme) => theme,
    });

  const bundledOr = (name: string, value: string) => {
    const known = bundledThemeIds.has(value);

    if (!known) {
      issues.push(
        `theme "${name}": unknown syntax theme ${JSON.stringify(value)}`
      );
    }

    return known ? value : undefined;
  };

  /**
   * A `syntax` names a bundled theme, overrides the base's syntax tokens, or is absent and
   * inherits the base's bundled theme.
   */
  const syntaxOf = (
    name: string,
    value: Schema.Json | undefined,
    inherited: string | undefined
  ) => {
    if (Predicate.isString(value)) {
      return { overrides: {}, syntaxTheme: bundledOr(name, value) };
    }

    if (value === undefined) {
      return { overrides: {}, syntaxTheme: inherited };
    }

    if (isJsonObject(value)) {
      return { overrides: value, syntaxTheme: undefined };
    }

    issues.push(
      `theme "${name}": syntax must be a bundled theme name or a token map`
    );

    return { overrides: {}, syntaxTheme: undefined };
  };

  const resolve = (
    name: string,
    stack: string[]
  ): RegisteredTheme | undefined => {
    const cached = resolved.get(name);

    if (cached !== undefined) {
      return cached;
    }

    if (failed.has(name)) {
      return undefined;
    }

    if (!Object.hasOwn(raw, name)) {
      // Not a user theme: a built-in is the only other source (used by `base`).
      return builtins.get(name);
    }

    const entry = raw[name];

    if (stack.includes(name)) {
      issues.push(`theme "${name}" has a circular base`);
      failed.add(name);

      return undefined;
    }

    if (!isJsonObject(entry)) {
      // Decode reports why a non-object entry isn't a theme
      tokensOf(name, entry);
      failed.add(name);

      return undefined;
    }

    const { base: baseName, syntax: syntaxValue, ...uiTokens } = entry;

    const base = Predicate.isString(baseName)
      ? resolve(baseName, [...stack, name])
      : undefined;

    if (Predicate.isString(baseName) && base === undefined) {
      issues.push(`theme "${name}": base "${baseName}" not found`);
      failed.add(name);

      return undefined;
    }

    const { overrides, syntaxTheme } = syntaxOf(
      name,
      syntaxValue,
      base?.syntaxTheme
    );

    const mergedUi =
      base === undefined ? uiTokens : mergeDeep(base.tokens, uiTokens);

    const syntax = mergeDeep(
      base?.tokens.syntax ?? darkTheme.syntax,
      overrides
    );

    const candidate = isJsonObject(mergedUi)
      ? Object.fromEntries([...Object.entries(mergedUi), ["syntax", syntax]])
      : mergedUi;

    const tokens = tokensOf(name, candidate);

    if (tokens === undefined) {
      failed.add(name);

      return undefined;
    }

    const record: RegisteredTheme = { syntaxTheme, tokens };
    resolved.set(name, record);

    return record;
  };

  for (const name of Object.keys(raw)) {
    resolve(name, []);
  }

  return { issues, themes: resolved };
};

export const registerThemes = (themes: Map<string, RegisteredTheme>) => {
  for (const [name, theme] of themes) {
    registry.set(name, theme);
  }
};
