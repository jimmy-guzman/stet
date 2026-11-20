import { state } from "@/state";
import { theme } from "@/theme/context";

/**
 * The tone of a pane's empty-state line, which is the pane's focus mark when it has no rows or caret
 * to light: full strength while the pane holds focus, muted otherwise.
 */
export const emptyStateTone = (pane: "tree" | "diff") =>
  state.focusedPane() === pane
    ? theme.colors.text.primary
    : theme.colors.text.muted;
