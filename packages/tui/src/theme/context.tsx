import { activeTheme } from "./active";
import type { ResolvedTheme } from "./resolve";

// `useTheme` returns a stable handle whose `colors`/`rgba` getters read the active
// Theme memo. Every call site reads `theme.colors.x` / `theme.rgba.x` inside JSX
// Or a thunk (a reactive scope), so the getter subscribes them to the memo: a
// Runtime appearance flip re-themes only the affected renderables, with no call
// Site change. The memo caches per theme, so `rgba.transparent` identity stays
// Stable within an appearance.
const theme: ResolvedTheme = {
  get colors() {
    return activeTheme().colors;
  },
  get rgba() {
    return activeTheme().rgba;
  },
};

export function useTheme(): ResolvedTheme {
  return theme;
}
