import { activeThemeName } from "./mode";
import { themeForName } from "./registry";
import { resolveTheme, type ResolvedTheme } from "./resolve";

// Theme is static in v1, so a resolved singleton is enough; `useTheme` keeps the
// Call site stable for a future runtime theme switch (a signal would slot in
// Here). Resolved lazily on first use (the first render, after startup selection
// Has applied the active theme name) and memoized for the session, so the
// Singleton reflects the configured theme without re-resolving per call.
let resolved: ResolvedTheme | undefined;

export function useTheme(): ResolvedTheme {
  return (resolved ??= resolveTheme(themeForName(activeThemeName())));
}
