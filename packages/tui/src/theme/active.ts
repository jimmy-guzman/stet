import { createMemo, createRoot, createSignal } from "solid-js";

import { selectThemeName, themeForName } from "./registry";
import type { ThemeSelection } from "./registry";
import { resolveTheme } from "./resolve";
import type { ResolvedTheme } from "./resolve";
import { isMonochromeTheme } from "./tokens";

// The reactive theme state, the single seam the UI (useTheme) and the diff engine
// Read. `appearance` follows the terminal: detected once at startup, then updated
// Live by the renderer's theme_mode event. `selection` is the config choice. The
// Active theme derives from both, so a dark/light flip re-resolves everything that
// Reads it. Kept in its own root (not src/state.ts) so the diff engine can read
// Theme state without importing app state, preserving the engine -> theme boundary.
const root = createRoot(() => {
  const [appearance, setAppearance] = createSignal<"dark" | "light">("dark");
  const [selection, setSelection] = createSignal<ThemeSelection>(undefined);
  const activeThemeName = createMemo(() => selectThemeName(selection(), appearance()));
  const activeTheme = createMemo<ResolvedTheme>(() =>
    resolveTheme(themeForName(activeThemeName())),
  );
  // Whether the active theme is hue-free, for the renders that swap a color-only
  // Signal for a glyph one (the viewer's change bar). A memo over the name, so a
  // Theme-switcher preview flips it live.
  const activeThemeMonochrome = createMemo(() =>
    isMonochromeTheme(themeForName(activeThemeName())),
  );
  return {
    activeTheme,
    activeThemeMonochrome,
    activeThemeName,
    appearance,
    selection,
    setAppearance,
    setSelection,
  };
});

export const {
  activeTheme,
  activeThemeMonochrome,
  activeThemeName,
  appearance,
  selection,
  setAppearance,
  setSelection,
} = root;
