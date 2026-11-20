import { createMemo, createRoot, createSignal } from "solid-js";

import { deriveTheme } from "./derive";
import { hasTheme, selectThemeName, zedThemeForName } from "./registry";
import type { ThemeSelection } from "./registry";
import { resolveTheme } from "./resolve";
import type { ResolvedTheme } from "./resolve";
import { isMonochromeTheme } from "./tokens";

// The reactive theme state, the single seam the UI (`theme`) and the diff engine
// Read. `appearance` follows the terminal: detected once at startup, then updated
// Live by the renderer's theme_mode event. `selection` is the config choice. The
// Active theme derives from both, so a dark/light flip re-resolves everything that
// Reads it. Kept in its own root (not src/state.ts) so the diff engine can read
// Theme state without importing app state, preserving the engine -> theme boundary.
const root = createRoot(() => {
  const [appearance, setAppearance] = createSignal<"dark" | "light">("dark");
  const [selection, setSelection] = createSignal<ThemeSelection>(undefined);

  // A selected name that resolves to nothing (a user theme file removed since
  // The config was saved) renders the default without touching the selection,
  // So a later `ctrl-s` never rewrites the user's choice away.
  const activeThemeName = createMemo(() => {
    const name = selectThemeName(selection(), appearance());

    return hasTheme(name) ? name : selectThemeName(undefined, appearance());
  });

  // The Zed theme behind the active name. A memo with identity equality, so a
  // Registry bump that leaves this name's theme unchanged (another bundled theme
  // Loading) wakes nothing downstream.
  const activeZedTheme = createMemo(() => zedThemeForName(activeThemeName()));

  const activeTheme = createMemo<ResolvedTheme>(() =>
    resolveTheme(deriveTheme(activeZedTheme()))
  );

  // Whether the active theme is hue-free, for the renders that swap a color-only
  // Signal for a glyph one (the viewer's change bar). A memo over the theme, so a
  // Theme-switcher preview flips it live.
  const activeThemeMonochrome = createMemo(() =>
    isMonochromeTheme(deriveTheme(activeZedTheme()))
  );

  return {
    activeTheme,
    activeThemeMonochrome,
    activeThemeName,
    activeZedTheme,
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
  activeZedTheme,
  appearance,
  selection,
  setAppearance,
  setSelection,
} = root;
