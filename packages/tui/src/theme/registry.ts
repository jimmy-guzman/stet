import { themes } from "@pierre/highlights/themes/loader";
import { Predicate } from "effect";
import { createSignal } from "solid-js";

import { builtinThemes } from "./builtins";
import { deriveTheme } from "./derive";
import { normalizeTheme } from "./zed";
import type { ZedTheme } from "./zed";

/**
 * Kept here, not imported from config, so theme/ stays free of a config dependency; the config
 * schema validates the matching shape.
 */
export type ThemeSelection =
  | string
  | { dark: string; light: string }
  | undefined;

/** The theme built from the terminal's own palette, registered once the terminal reports one. */
export const SYSTEM_THEME = "system";

/** The switcher row for no selection, which follows the terminal; a name no theme may take. */
export const AUTO_THEME = "auto";

const builtins = new Map(
  builtinThemes.map((theme) => [theme.name, normalizeTheme(theme)])
);

const bundledNames = Object.keys(themes);

/** Bundled themes whose import failed: no longer listed or selectable, so none renders a fallback. */
const failedBundled = new Set<string>();

const availableBundled = () =>
  bundledNames.filter((name) => !failedBundled.has(name));

const registry = new Map<string, ZedTheme>(builtins);

/** User theme names in registration order, the tail of the switcher's list. */
const userNames: string[] = [];

/**
 * Bumped on every registry write and read by every lookup, so a memo over a theme name (the active
 * theme in `active.ts`) re-resolves when the entry behind an unchanged name is replaced or loaded: a
 * bundled theme finishing its import, a re-probed `system`, or the test preload restoring the
 * built-ins.
 */
const [registryVersion, setRegistryVersion] = createSignal(0);

const readRegistry = () => {
  registryVersion();

  return registry;
};

const bumpRegistry = () => setRegistryVersion((version) => version + 1);

const fallback = () => builtins.get("stet-dark") ?? builtinThemes[0];

/**
 * The theme registered under `name`. A bundled theme still loading, or an unknown name, answers the
 * `stet-dark` fallback until it lands.
 */
export const zedThemeForName = (name: string) =>
  readRegistry().get(name) ?? fallback();

export const themeForName = (name: string) =>
  deriveTheme(zedThemeForName(name));

export const hasTheme = (name: string) =>
  readRegistry().has(name) || availableBundled().includes(name);

/** `system` first when present, then stet's own, the bundled themes, and user themes. */
export const themeNames = () => [
  ...new Set([
    ...(readRegistry().has(SYSTEM_THEME) ? [SYSTEM_THEME] : []),
    ...builtins.keys(),
    ...availableBundled(),
    ...userNames,
  ]),
];

/**
 * One bundled theme, normalized, as a one-element list; empty when its import fails, which also
 * drops it from the list, so it can never take the others, or a running session, down with it.
 */
const importTheme = async (name: string) => {
  try {
    const { default: theme } = await themes[name]();

    return [normalizeTheme(theme)];
  } catch {
    failedBundled.add(name);

    return [];
  }
};

/** Import one bundled theme; a no-op for any other name or one already loaded. */
export const loadTheme = async (name: string) => {
  if (!bundledNames.includes(name) || registry.has(name)) {
    return;
  }

  for (const theme of await importTheme(name)) {
    registry.set(name, theme);
  }

  bumpRegistry();
};

/**
 * Import every bundled theme, for the switcher. Run after the first paint: the whole set is ~20ms of
 * module evaluation the startup path should not pay. One registry bump for the batch, so the active
 * theme re-resolves once.
 */
export const loadBundledThemes = async () => {
  const loaded = await Promise.all(
    bundledNames
      .filter((name) => !registry.has(name))
      .map(async (name) => {
        const imported = await importTheme(name);

        return imported.map((theme) => [name, theme] as const);
      })
  );

  for (const [name, theme] of loaded.flat()) {
    registry.set(name, theme);
  }

  bumpRegistry();
};

/** Register user themes under their file-derived names; a name may replace a built-in. */
export const registerThemes = (
  userThemes: Iterable<readonly [string, ZedTheme]>
) => {
  for (const [name, theme] of userThemes) {
    registry.set(name, normalizeTheme(theme));
    userNames.push(name);
  }

  bumpRegistry();
};

export const registerSystemTheme = (theme: ZedTheme) => {
  registry.set(SYSTEM_THEME, normalizeTheme(theme));
  bumpRegistry();
};

/**
 * Test-only: the registry is a process-global map, so the test preload resets it to the built-ins
 * before every test.
 */
export const restoreRegistry = () => {
  registry.clear();

  for (const [name, theme] of builtins) {
    registry.set(name, theme);
  }

  userNames.length = 0;
  failedBundled.clear();
  bumpRegistry();
};

/**
 * Names the built-ins had before themes became palettes, which `ctrl-s` wrote into configs; they
 * keep resolving so an existing config is never orphaned.
 */
const renamedThemes = new Map([
  ["dark", "stet-dark"],
  ["light", "stet-light"],
]);

/**
 * Names a user theme cannot take because stet already gives them a meaning: `system` is the
 * terminal's palette, which any palette report overwrites (at startup or mid-session, and with none
 * a user theme there would silently become the default); `auto` is the switcher's follow-the-terminal
 * row; and the former built-in names always resolve to `stet-*`, so a theme under them would list but
 * never render.
 */
export const isReservedThemeName = (name: string) =>
  name === SYSTEM_THEME || name === AUTO_THEME || renamedThemes.has(name);

/** A theme's current name: a former built-in name (`dark`) maps to its new one, anything else is unchanged. */
export const canonicalThemeName = (name: string) =>
  renamedThemes.get(name) ?? name;

const pickName = (selection: ThemeSelection, appearance: "dark" | "light") => {
  if (selection === undefined) {
    return readRegistry().has(SYSTEM_THEME)
      ? SYSTEM_THEME
      : `stet-${appearance}`;
  }

  return Predicate.isString(selection) ? selection : selection[appearance];
};

/**
 * The theme name a selection picks for an appearance. No selection follows the terminal: its own
 * palette (`system`) when it reported one, else stet's pair for the appearance.
 */
export const selectThemeName = (
  selection: ThemeSelection,
  appearance: "dark" | "light"
) => canonicalThemeName(pickName(selection, appearance));
