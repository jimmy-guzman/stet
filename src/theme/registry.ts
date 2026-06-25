import { Result, Schema } from "effect";
import { bundledThemesInfo } from "shiki/themes";

import { darkTheme } from "./dark";
import { lightTheme } from "./light";
import { mergeDeep } from "./merge";
import { ThemeSchema, type Theme } from "./tokens";

// A selection is a single pinned name, or an appearance-keyed pair that follows
// The terminal. Kept here (not imported from config) so theme/ stays free of a
// Config dependency; the config schema validates the matching shape.
export type ThemeSelection = string | { dark: string; light: string } | undefined;

// A registered theme: the UI/diff tokens, plus an optional bundled Shiki theme id
// For syntax highlighting. When `syntaxTheme` is set, code colors come from that
// Bundled theme while sideye still layers diff backgrounds from `tokens`.
interface RegisteredTheme {
  tokens: Theme;
  syntaxTheme?: string;
}

const builtins: Record<string, RegisteredTheme> = {
  dark: { tokens: darkTheme },
  light: { tokens: lightTheme },
};

const registry = new Map<string, RegisteredTheme>(Object.entries(builtins));

// The set of valid bundled Shiki theme ids a `syntaxTheme` may name.
const bundledThemeIds = new Set(bundledThemesInfo.map((theme) => theme.id));

/** The active theme's tokens, or the dark built-in if the name is unknown. */
export function themeForName(name: string): Theme {
  return registry.get(name)?.tokens ?? darkTheme;
}

/** The bundled Shiki theme id for a theme, if it opted into one for syntax. */
export function syntaxThemeForName(name: string) {
  return registry.get(name)?.syntaxTheme;
}

export function hasTheme(name: string) {
  return registry.has(name);
}

/** The built-in name for an appearance; pinned/paired selections override it. */
export function selectThemeName(selection: ThemeSelection, appearance: "dark" | "light") {
  if (selection === undefined) {
    return appearance;
  }
  return typeof selection === "string" ? selection : selection[appearance];
}

export interface ResolvedThemes {
  themes: Map<string, RegisteredTheme>;
  issues: string[];
}

const decodeTheme = Schema.decodeUnknownResult(ThemeSchema);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Resolve raw config theme entries into validated themes. An entry is either a full theme or `{
 * base, ...overrides }` merged over another theme (a built-in or another custom theme), optionally
 * with a `syntaxTheme` (a bundled Shiki id, or inherited from the base). Bases resolve lazily with
 * cycle detection; an invalid entry, unknown base, unknown syntaxTheme, or cycle is reported rather
 * than crashing (the syntaxTheme is dropped, the rest still resolves).
 */
export function resolveThemes(raw: Record<string, unknown>): ResolvedThemes {
  const resolved = new Map<string, RegisteredTheme>();
  const issues: string[] = [];

  const tokensOf = (name: string, candidate: unknown) =>
    Result.match(decodeTheme(candidate), {
      onFailure: (error) => {
        issues.push(`theme "${name}": ${String(error)}`);
        return undefined;
      },
      onSuccess: (theme) => theme,
    });

  const ownSyntaxTheme = (name: string, entry: Record<string, unknown>) => {
    if (!("syntaxTheme" in entry)) {
      return undefined;
    }
    const value = entry.syntaxTheme;
    if (typeof value === "string" && bundledThemeIds.has(value)) {
      return value;
    }
    issues.push(`theme "${name}": unknown syntaxTheme ${JSON.stringify(value)}`);
    return undefined;
  };

  const resolve = (name: string, stack: string[]): RegisteredTheme | undefined => {
    const cached = resolved.get(name);
    if (cached !== undefined) {
      return cached;
    }
    const entry = raw[name];
    if (entry === undefined) {
      // Not a user theme: a built-in is the only other source (used by `base`).
      return builtins[name];
    }
    if (stack.includes(name)) {
      issues.push(`theme "${name}" has a circular base`);
      return undefined;
    }
    if (!isPlainObject(entry)) {
      tokensOf(name, entry);
      return undefined;
    }

    const syntaxTheme = ownSyntaxTheme(name, entry);
    const rest = { ...entry };
    delete rest.base;
    delete rest.syntaxTheme;

    let record: RegisteredTheme | undefined;
    if (typeof entry.base === "string") {
      const base = resolve(entry.base, [...stack, name]);
      if (base === undefined) {
        issues.push(`theme "${name}": base "${entry.base}" not found`);
      } else {
        const tokens = tokensOf(name, mergeDeep(base.tokens, rest));
        if (tokens !== undefined) {
          record = { syntaxTheme: syntaxTheme ?? base.syntaxTheme, tokens };
        }
      }
    } else {
      const tokens = tokensOf(name, rest);
      if (tokens !== undefined) {
        record = { syntaxTheme, tokens };
      }
    }

    if (record !== undefined) {
      resolved.set(name, record);
    }
    return record;
  };

  for (const name of Object.keys(raw)) {
    resolve(name, []);
  }

  return { issues, themes: resolved };
}

export function registerThemes(themes: Map<string, RegisteredTheme>) {
  for (const [name, theme] of themes) {
    registry.set(name, theme);
  }
}
