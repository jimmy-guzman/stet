import { Result, Schema } from "effect";

import { darkTheme } from "./dark";
import { lightTheme } from "./light";
import { mergeDeep } from "./merge";
import { ThemeSchema, type Theme } from "./tokens";

// A selection is a single pinned name, or an appearance-keyed pair that follows
// The terminal. Kept here (not imported from config) so theme/ stays free of a
// Config dependency; the config schema validates the matching shape.
export type ThemeSelection = string | { dark: string; light: string } | undefined;

const builtins: Record<string, Theme> = { dark: darkTheme, light: lightTheme };

const registry = new Map<string, Theme>(Object.entries(builtins));

/** The active theme's tokens, or the dark built-in if the name is unknown. */
export function themeForName(name: string): Theme {
  return registry.get(name) ?? darkTheme;
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
  themes: Map<string, Theme>;
  issues: string[];
}

const decodeTheme = Schema.decodeUnknownResult(ThemeSchema);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Resolve raw config theme entries into validated themes. An entry is either a full theme or `{
 * base, ...overrides }` merged over another theme (a built-in or another custom theme). Bases
 * resolve lazily with cycle detection; an invalid entry, unknown base, or cycle is skipped with an
 * issue rather than crashing.
 */
export function resolveThemes(raw: Record<string, unknown>): ResolvedThemes {
  const resolved = new Map<string, Theme>();
  const issues: string[] = [];

  const validate = (name: string, candidate: unknown) =>
    Result.match(decodeTheme(candidate), {
      onFailure: (error) => {
        issues.push(`theme "${name}": ${String(error)}`);
        return undefined;
      },
      onSuccess: (theme) => theme,
    });

  const resolve = (name: string, stack: string[]): Theme | undefined => {
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

    let theme: Theme | undefined;
    if (isPlainObject(entry) && typeof entry.base === "string") {
      const { base, ...overrides } = entry;
      const baseTheme = resolve(base, [...stack, name]);
      if (baseTheme === undefined) {
        issues.push(`theme "${name}": base "${base}" not found`);
      } else {
        theme = validate(name, mergeDeep(baseTheme, overrides));
      }
    } else {
      theme = validate(name, entry);
    }

    if (theme !== undefined) {
      resolved.set(name, theme);
    }
    return theme;
  };

  for (const name of Object.keys(raw)) {
    resolve(name, []);
  }

  return { issues, themes: resolved };
}

export function registerThemes(themes: Map<string, Theme>) {
  for (const [name, theme] of themes) {
    registry.set(name, theme);
  }
}
