import { themeMode } from "./mode";
import { resolveTheme, themeForMode, type ResolvedTheme } from "./resolve";

// Theme is static in v1, so a resolved singleton is enough; `useTheme` keeps the
// Call site stable for a future runtime theme switch (a signal would slot in
// Here). Resolved lazily on first use (the first render, after startup detection
// Has applied the mode) and memoized for the session, so the singleton reflects
// The terminal's appearance without re-resolving per call.
let resolved: ResolvedTheme | undefined;

export function useTheme(): ResolvedTheme {
  return (resolved ??= resolveTheme(themeForMode(themeMode())));
}
