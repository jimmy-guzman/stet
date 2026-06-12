import { createContext, useContext, type ReactNode } from "react"
import { darkTheme } from "./dark"
import { resolveTheme, type ResolvedTheme } from "./resolve"

// Defaulting to resolved dark lets tests render components without a provider
const ThemeContext = createContext<ResolvedTheme>(resolveTheme(darkTheme))

export function ThemeProvider({ children, theme }: { children: ReactNode; theme: ResolvedTheme }) {
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
}

export function useTheme(): ResolvedTheme {
  return useContext(ThemeContext)
}
