import { RGBA } from "@opentui/core";

import { darkTheme } from "./dark";
import { lightTheme } from "./light";
import type { Theme } from "./tokens";

// Call sites that paint line colors need RGBA objects; resolving once per
// Theme keeps them stable singletons, so identity checks against
// Rgba.transparent keep working and renders never re-convert
export interface ResolvedTheme {
  colors: Theme;
  rgba: {
    addedBg: RGBA;
    cursorBg: RGBA;
    errorGutterBg: RGBA;
    findMatchBg: RGBA;
    infoGutterBg: RGBA;
    removedBg: RGBA;
    transparent: RGBA;
    warningGutterBg: RGBA;
  };
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  return {
    colors: theme,
    rgba: {
      addedBg: RGBA.fromHex(theme.diff.addedBg),
      cursorBg: RGBA.fromHex(theme.surface.cursor),
      errorGutterBg: RGBA.fromHex(theme.severity.errorGutterBg),
      findMatchBg: RGBA.fromHex(theme.find.matchBg),
      infoGutterBg: RGBA.fromHex(theme.severity.infoGutterBg),
      removedBg: RGBA.fromHex(theme.diff.removedBg),
      transparent: RGBA.fromValues(0, 0, 0, 0),
      warningGutterBg: RGBA.fromHex(theme.severity.warningGutterBg),
    },
  };
}

/**
 * Resolves a theme mode to its token set. The seam for a future runtime switch
 * (renderer.waitForThemeMode / THEME_MODE event); today the mode is fixed in `theme/mode.ts`.
 */
export function themeForMode(mode: "dark" | "light"): Theme {
  return mode === "light" ? lightTheme : darkTheme;
}
