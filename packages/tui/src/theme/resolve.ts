import { RGBA, rgbToHex } from "@opentui/core";

import { lerpHex } from "@/utils/color";

import type { Theme } from "./tokens";

// Call sites that paint line colors need RGBA objects; resolving once per
// Theme keeps them stable singletons, so identity checks against
// Rgba.transparent keep working and renders never re-convert
export interface ResolvedTheme {
  colors: Theme;
  // The "...Active" variants emphasize a line's background for the current (cursor) line,
  // So a selected tinted line reads as a stronger version of its own state rather than
  // Being flattened to grey. The emphasis direction follows the surface luminance:
  // Lift toward white on dark surfaces, darken toward the line's own hue on a light
  // Surface, where a brighten would clamp to white.
  // The "...WordBg" variants mark the changed words inside a paired removed/added line
  // The way `@pierre/diffs` does: the line's sign color layered at low opacity over the
  // Line's own background (normal, or the lifted cursor/selection one), so a changed
  // Word stands out on either. Derived rather than tokens, so every theme (a user's
  // Full theme included) gets them without new keys.
  rgba: {
    addedBgActive: RGBA;
    addedWordBg: RGBA;
    addedWordBgActive: RGBA;
    findMatchBgActive: RGBA;
    removedBgActive: RGBA;
    removedWordBg: RGBA;
    removedWordBgActive: RGBA;
    scrim: RGBA;
    transparent: RGBA;
  };
}

// Multiplicative RGB scale: moves lightness while preserving hue (channel ratios),
// So a dark red stays red as it brightens and a light green stays green as it
// Darkens, rather than washing toward neutral grey. factor > 1 brightens toward
// White (clamped); factor < 1 darkens toward black.
const scaleRgba = (hex: string, factor: number) => {
  const base = RGBA.fromHex(hex);
  const lift = (channel: number) => Math.min(1, channel * factor);

  return RGBA.fromValues(lift(base.r), lift(base.g), lift(base.b), base.a);
};

// Perceptual luminance (Rec. 601) of surface.base decides the emphasis direction.
const surfaceIsLight = (hex: string) => {
  const { r, g, b } = RGBA.fromHex(hex);

  return 0.299 * r + 0.587 * g + 0.114 * b > 0.5;
};

// Brighten dark diff backgrounds toward white; darken light ones toward their own
// Hue (a brighten would clamp the already near-white light palette to pure white).
const DARK_ACTIVE_FACTOR = 1.6;
const LIGHT_ACTIVE_FACTOR = 0.82;

// `@pierre/diffs`' changed-word emphasis: its sign color at 20% over a dark line, 15%
// Over a light one.
const DARK_WORD_ALPHA = 0.2;
const LIGHT_WORD_ALPHA = 0.15;

// Opacity of the alert-dialog backdrop over the app: enough to read as modal,
// Light enough that the dimmed content stays legible behind it.
const SCRIM_ALPHA = 0.5;

export const resolveTheme = (theme: Theme): ResolvedTheme => {
  const light = surfaceIsLight(theme.surface.base);
  const factor = light ? LIGHT_ACTIVE_FACTOR : DARK_ACTIVE_FACTOR;
  const wordAlpha = light ? LIGHT_WORD_ALPHA : DARK_WORD_ALPHA;
  const active = (hex: string) => scaleRgba(hex, factor);

  const word = (under: RGBA, signHex: string) =>
    RGBA.fromHex(lerpHex(rgbToHex(under), signHex, wordAlpha));

  const scrim = RGBA.fromHex(theme.surface.scrim);

  return {
    colors: theme,
    rgba: {
      addedBgActive: active(theme.diff.addedBg),
      addedWordBg: word(RGBA.fromHex(theme.diff.addedBg), theme.diff.addedSign),
      addedWordBgActive: word(active(theme.diff.addedBg), theme.diff.addedSign),
      findMatchBgActive: active(theme.find.matchBg),
      removedBgActive: active(theme.diff.removedBg),
      removedWordBg: word(
        RGBA.fromHex(theme.diff.removedBg),
        theme.diff.removedSign
      ),
      removedWordBgActive: word(
        active(theme.diff.removedBg),
        theme.diff.removedSign
      ),
      scrim: RGBA.fromValues(scrim.r, scrim.g, scrim.b, SCRIM_ALPHA),
      transparent: RGBA.fromValues(0, 0, 0, 0),
    },
  };
};
