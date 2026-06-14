import { darkTheme } from "./dark"
import { resolveTheme, type ResolvedTheme } from "./resolve"

// Theme is static in v1, so a resolved singleton is enough; `useTheme` keeps the
// Call site stable for a future runtime theme switch (a signal would slot in here).
const theme = resolveTheme(darkTheme)

export function useTheme(): ResolvedTheme {
  return theme
}
