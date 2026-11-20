import { themes as bundledLoaders } from "@pierre/highlights/themes/loader";
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

const builtins = new Map(
  builtinThemes.map((theme) => [theme.name, normalizeTheme(theme)])
);

const bundledNames = Object.keys(bundledLoaders);

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
  readRegistry().has(name) || bundledNames.includes(name);

/** `system` first when present, then stet's own, the bundled themes, and user themes. */
export const themeNames = () => [
  ...new Set([
    ...(readRegistry().has(SYSTEM_THEME) ? [SYSTEM_THEME] : []),
    ...builtins.keys(),
    ...bundledNames,
    ...userNames,
  ]),
];

/** Import one bundled theme; a no-op for any other name or one already loaded. */
export const loadTheme = async (name: string) => {
  const load = bundledLoaders[name];

  if (load === undefined || registry.has(name)) {
    return;
  }

  const { default: theme } = await load();
  registry.set(name, normalizeTheme(theme));
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
        try {
          const { default: theme } = await bundledLoaders[name]();

          return [[name, normalizeTheme(theme)] as const];
        } catch {
          // One theme that fails to import is left out of the switcher; it must never take the
          // Others, or a running session, down with it.
          return [];
        }
      })
  );

  for (const [name, theme] of loaded.flat()) {
    registry.set(name, theme);
  }

  bumpRegistry();
};

/** Register user themes under their file-derived names; a name may replace a built-in. */
export const registerThemes = (themes: ReadonlyMap<string, ZedTheme>) => {
  for (const [name, theme] of themes) {
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
) => {
  const name = pickName(selection, appearance);

  return renamedThemes.get(name) ?? name;
};
