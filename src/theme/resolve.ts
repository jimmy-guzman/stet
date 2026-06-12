import { RGBA } from "@opentui/core"
import { darkTheme } from "./dark"
import type { Theme } from "./tokens"

// Call sites that paint line colors need RGBA objects; resolving once per
// Theme keeps them stable singletons, so identity checks against
// Rgba.transparent keep working and renders never re-convert
export interface ResolvedTheme {
  colors: Theme
  rgba: {
    addedBg: RGBA
    cursorBg: RGBA
    errorGutterBg: RGBA
    removedBg: RGBA
    transparent: RGBA
    warningGutterBg: RGBA
  }
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  return {
    colors: theme,
    rgba: {
      addedBg: RGBA.fromHex(theme.diff.addedBg),
      cursorBg: RGBA.fromHex(theme.surface.cursor),
      errorGutterBg: RGBA.fromHex(theme.severity.errorGutterBg),
      removedBg: RGBA.fromHex(theme.diff.removedBg),
      transparent: RGBA.fromValues(0, 0, 0, 0),
      warningGutterBg: RGBA.fromHex(theme.severity.warningGutterBg),
    },
  }
}

// Seam for system light/dark detection (renderer.waitForThemeMode / THEME_MODE
// Event); returns dark until a light theme exists
export function themeForMode(_mode: "dark" | "light"): Theme {
  return darkTheme
}
