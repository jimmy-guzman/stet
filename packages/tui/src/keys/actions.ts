/**
 * The canonical registry of rebindable actions: every global and pane binding, in the keymap's
 * dispatch order. Overlay-internal keys (pickers, menus, the quit confirm, the search pane) are a
 * shared convention and stay fixed, so they are deliberately absent. Default combo texts are
 * written in the help's display style; all of them must parse under `parseCombo` (test-guarded).
 *
 * `context` is where the keymap consults the binding: `global` runs before the pane tails, so a
 * combo bound in `global` shadows the same combo in any pane.
 */
export type KeyContext = "global" | "problems" | "tree" | "viewer";

export const keyActions = [
  { combos: ["ctrl-p"], context: "global", id: "go-to-file" },
  { combos: ["ctrl-f"], context: "global", id: "search" },
  { combos: ["/"], context: "global", id: "find" },
  { combos: ["q"], context: "global", id: "quit" },
  { combos: ["tab"], context: "global", id: "switch-pane" },
  { combos: ["p"], context: "global", id: "problems" },
  { combos: ["ctrl-b"], context: "global", id: "toggle-sidebar" },
  { combos: ["]"], context: "global", id: "grow-sidebar" },
  { combos: ["["], context: "global", id: "shrink-sidebar" },
  { combos: ["\\"], context: "global", id: "reset-sidebar" },
  { combos: ["?"], context: "global", id: "help" },
  { combos: ["ctrl-t"], context: "global", id: "pin-tab" },
  { combos: ["ctrl-w"], context: "global", id: "close-tab" },
  { combos: ["{"], context: "global", id: "prev-tab" },
  { combos: ["}"], context: "global", id: "next-tab" },
  { combos: ["w"], context: "global", id: "worktrees" },
  { combos: ["S"], context: "global", id: "symbols" },
  { combos: ["s"], context: "global", id: "scope" },
  { combos: ["t"], context: "global", id: "theme" },
  { combos: ["ctrl-s"], context: "global", id: "save-settings" },
  { combos: ["c"], context: "global", id: "changes-only" },
  { combos: ["x"], context: "global", id: "toggle-wrap" },
  { combos: ["a"], context: "global", id: "provenance" },
  { combos: ["."], context: "global", id: "latest-file" },
  { combos: ["<"], context: "global", id: "back" },
  { combos: [">"], context: "global", id: "forward" },
  { combos: ["Shift+F10"], context: "global", id: "context-menu" },
  { combos: ["v"], context: "global", id: "toggle-view" },
  { combos: ["n"], context: "global", id: "next-finding" },
  { combos: ["r"], context: "global", id: "run-checks" },
  { combos: ["R"], context: "global", id: "restart-servers" },
  { combos: ["f"], context: "global", id: "load-full" },
  { combos: ["e"], context: "global", id: "open-editor" },
  { combos: ["O"], context: "global", id: "open-external" },
  { combos: ["o"], context: "global", id: "open-ide" },
  { combos: ["F12"], context: "global", id: "go-to-definition" },
  { combos: ["Shift+F12"], context: "global", id: "find-references" },
  { combos: ["K"], context: "global", id: "hover" },
  { combos: ["Shift+H"], context: "global", id: "call-hierarchy" },
  { combos: ["Shift+I"], context: "global", id: "implementations" },
  { combos: ["Y"], context: "global", id: "copy-file" },
  { combos: ["C"], context: "global", id: "copy-selection" },
  { combos: ["y"], context: "global", id: "copy-reference" },
  { combos: ["Shift+↓"], context: "viewer", id: "select-down" },
  { combos: ["Shift+↑"], context: "viewer", id: "select-up" },
  { combos: ["j", "↓"], context: "viewer", id: "cursor-down" },
  { combos: ["k", "↑"], context: "viewer", id: "cursor-up" },
  { combos: ["ctrl-d"], context: "viewer", id: "half-page-down" },
  { combos: ["ctrl-u"], context: "viewer", id: "half-page-up" },
  { combos: ["g"], context: "viewer", id: "first-line" },
  { combos: ["G"], context: "viewer", id: "last-line" },
  { combos: ["l", "→"], context: "viewer", id: "caret-next" },
  { combos: ["h", "←"], context: "viewer", id: "caret-prev" },
  { combos: ["z"], context: "viewer", id: "fold" },
  { combos: ["j", "↓"], context: "tree", id: "focus-down" },
  { combos: ["k", "↑"], context: "tree", id: "focus-up" },
  { combos: ["l", "→"], context: "tree", id: "expand" },
  { combos: ["h", "←"], context: "tree", id: "collapse" },
  { combos: ["enter"], context: "tree", id: "open" },
  { combos: ["j", "↓"], context: "problems", id: "problem-down" },
  { combos: ["k", "↑"], context: "problems", id: "problem-up" },
  { combos: ["enter"], context: "problems", id: "open-problem" },
] as const satisfies readonly {
  combos: readonly [string, ...string[]];
  context: KeyContext;
  id: string;
}[];

export type KeyActionId = (typeof keyActions)[number]["id"];
