import { RGBA } from "@opentui/core";

import type { Theme } from "./tokens";

// Call sites that paint line colors need RGBA objects; resolving once per
// Theme keeps them stable singletons, so identity checks against
// Rgba.transparent keep working and renders never re-convert
export interface ResolvedTheme {
  colors: Theme;
  // "...Active" variants are the diff backgrounds brightened for the current
  // (cursor) line, so a selected add/remove line reads as a brighter version of
  // Its own state instead of being flattened to grey.
  rgba: {
    addedBgActive: RGBA;
    addedLineNumberBgActive: RGBA;
    findMatchBgActive: RGBA;
    removedBgActive: RGBA;
    removedLineNumberBgActive: RGBA;
    transparent: RGBA;
  };
}

// Multiplicative RGB scale: lifts lightness while preserving hue (channel ratios),
// So a dark red stays red as it brightens rather than washing toward neutral grey.
function scaleRgba(hex: string, factor: number) {
  const base = RGBA.fromHex(hex);
  const lift = (channel: number) => Math.min(1, channel * factor);
  return RGBA.fromValues(lift(base.r), lift(base.g), lift(base.b), base.a);
}

const ACTIVE_FACTOR = 1.6;

export function resolveTheme(theme: Theme): ResolvedTheme {
  const active = (hex: string) => scaleRgba(hex, ACTIVE_FACTOR);
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
