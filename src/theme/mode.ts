// The active theme mode, the single seam both the UI (useTheme) and the diff
// Highlighter (engine) read so they stay in lockstep. It follows the terminal:
// `main.tsx` detects the appearance once at startup and applies it before the
// First paint, falling back to dark when the terminal does not report one. Read
// Lazily (via the getter) so the detected value lands before either consumer
// First resolves; static for the session in v1.
let active: "dark" | "light" = "dark";

export function themeMode() {
  return active;
}

export function setThemeMode(mode: "dark" | "light") {
  active = mode;
}

// The resolved active theme name (a registry key), set once at startup from the
// Config selection and the detected appearance. Falls back to the appearance so
// The built-in dark/light still applies when no theme is configured. Static for
// The session in v1; the reactive runtime switch is a follow-up (see #101).
let activeName: string | undefined;

export function activeThemeName() {
  return activeName ?? active;
}

export function setActiveThemeName(name: string) {
  activeName = name;
}
