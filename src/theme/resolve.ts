import { RGBA } from "@opentui/core";

import { darkTheme } from "./dark";
import { lightTheme } from "./light";
import type { Theme } from "./tokens";

// Call sites that paint line colors need RGBA objects; resolving once per
// Theme keeps them stable singletons, so identity checks against
// Rgba.transparent keep working and renders never re-convert
export interface ResolvedTheme {
  colors: Theme;
  // "...Active" variants emphasize the diff backgrounds for the current (cursor)
  // Line, so a selected add/remove line reads as a stronger version of its own
  // State instead of being flattened to grey. The emphasis direction follows the
  // Surface luminance: lift toward white on dark surfaces, darken toward the
  // Line's own hue on light surfaces (where a brighten would clamp to white).
  rgba: {
    addedBgActive: RGBA;
    addedLineNumberBgActive: RGBA;
    findMatchBgActive: RGBA;
    removedBgActive: RGBA;
    removedLineNumberBgActive: RGBA;
    transparent: RGBA;
  };
}

// Multiplicative RGB scale: moves lightness while preserving hue (channel ratios),
// So a dark red stays red as it brightens and a light green stays green as it
// Darkens, rather than washing toward neutral grey. factor > 1 brightens toward
// White (clamped); factor < 1 darkens toward black.
function scaleRgba(hex: string, factor: number) {
  const base = RGBA.fromHex(hex);
  const lift = (channel: number) => Math.min(1, channel * factor);
  return RGBA.fromValues(lift(base.r), lift(base.g), lift(base.b), base.a);
}

// Perceptual luminance (Rec. 601) of surface.base decides the emphasis direction.
function surfaceIsLight(hex: string) {
  const { r, g, b } = RGBA.fromHex(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b > 0.5;
}

// Brighten dark diff backgrounds toward white; darken light ones toward their own
// Hue (a brighten would clamp the already near-white light palette to pure white).
const DARK_ACTIVE_FACTOR = 1.6;
const LIGHT_ACTIVE_FACTOR = 0.82;

export function resolveTheme(theme: Theme): ResolvedTheme {
  const factor = surfaceIsLight(theme.surface.base) ? LIGHT_ACTIVE_FACTOR : DARK_ACTIVE_FACTOR;
  const active = (hex: string) => scaleRgba(hex, factor);
  return {
    colors: theme,
    rgba: {
      addedBgActive: active(theme.diff.addedBg),
      addedLineNumberBgActive: active(theme.diff.addedLineNumberBg),
      findMatchBgActive: active(theme.find.matchBg),
      removedBgActive: active(theme.diff.removedBg),
      removedLineNumberBgActive: active(theme.diff.removedLineNumberBg),
      transparent: RGBA.fromValues(0, 0, 0, 0),
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
