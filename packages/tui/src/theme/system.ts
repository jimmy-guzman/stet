import type { CliRenderer, TerminalColors } from "@opentui/core";
import { Predicate } from "effect";

import { isLightHex } from "@/utils/color";

import { ANSI_NAMES, ansiFromSlots, paletteTheme } from "./palette";
import { hasTheme, registerSystemTheme, SYSTEM_THEME } from "./registry";
import { opaqueHex } from "./zed";

/**
 * The `system` theme: the terminal's own background, foreground, and 16 colors, so stet looks like
 * the terminal it runs in. `undefined` unless the terminal reported all 18, since a partial answer
 * would mix its colors with guesses.
 */
export const systemTheme = ({
  defaultBackground,
  defaultForeground,
  palette,
}: TerminalColors) => {
  const slots = palette.slice(0, ANSI_NAMES.length).filter(Predicate.isString);
  const background = opaqueHex(defaultBackground ?? "", "#000000");

  return background === undefined ||
    defaultForeground === null ||
    slots.length < ANSI_NAMES.length
    ? undefined
    : paletteTheme(SYSTEM_THEME, isLightHex(background) ? "light" : "dark", {
        ansi: ansiFromSlots(slots),
        background,
        foreground: defaultForeground,
      });
};

/** Registers `system` from a palette the terminal reported, when it reported all of it. */
const registerTerminalPalette = (colors: TerminalColors) => {
  const theme = systemTheme(colors);

  if (theme !== undefined) {
    registerSystemTheme(theme);
  }
};

/** Asks the terminal for its palette (a bounded OSC query) and registers `system` from the answer. */
export const probeTerminalPalette = async (renderer: CliRenderer) => {
  try {
    registerTerminalPalette(
      await renderer.getPalette({ size: 16, timeout: 100 })
    );
  } catch {
    // A terminal that does not answer palette queries simply has no `system` theme.
  }
};

/**
 * Follows a palette the terminal reported mid-session (after a mode flip, or on resume), but only
 * for a `system` theme the startup probe already found: a terminal that answered late must not swap
 * the active theme, or shift the open switcher's rows, without the user asking.
 */
export const refreshTerminalPalette = (colors: TerminalColors) => {
  if (hasTheme(SYSTEM_THEME)) {
    registerTerminalPalette(colors);
  }
};
