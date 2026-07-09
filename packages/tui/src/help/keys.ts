/**
 * The one keybindings registry: the source of truth for the in-app `?` overlay (`HelpDialog`) and,
 * via `script/gen-docs-keys.ts`, the docs keybindings reference. Editing here and running `bun run
 * gen:keys` keeps them in lockstep; `bun run gen:keys --check` (in `docs:check`) fails the build if
 * they drift.
 */
export const KEY_HELP: { entries: [combo: string, action: string][]; heading: string }[] = [
  {
    entries: [
      ["j / k", "move in the tree, viewer, or problems panel"],
      ["h / l", "collapse / expand folders (tree) or hop the caret by word (viewer)"],
      ["tab", "switch focus between tree and viewer"],
      ["enter", "open the focused item / jump to a problem"],
      ["ctrl-p", "go to file: fuzzy-search the whole repo"],
      [".", "jump to the most recently changed file"],
      ["n", "jump to the next file with findings"],
    ],
    heading: "navigation",
  },
  {
    entries: [
      ["/", "find in the viewer; n/N cycle matches, esc clears"],
      ["ctrl-f", "project search pane; regex/case/scope/glob toggles"],
      ["v", "toggle diff ↔ full file view for a changed file"],
      ["z", "fold / unfold the region at the caret"],
      ["x", "toggle long-line wrap in the viewer"],
      ["f", "load full content when truncated"],
      ["ctrl-d/u", "half-page cursor movement in the viewer"],
      ["g / G", "jump to first / last line"],
      ["F12", "go to definition of the symbol under the caret"],
      ["Shift+F12", "find references to the symbol under the caret"],
      ["Shift+I", "find implementations of the symbol under the caret"],
      ["Shift+H", "call hierarchy of the symbol (Tab flips direction)"],
      ["K", "hover: type and docs for the symbol under the caret"],
      ["S", "find symbols: outline of the open file"],
      ["< / >", "back / forward through viewer history"],
      ["y", "copy path (tree), path:line:col (viewer), or the selected search result"],
      ["Y", "copy the entire contents of the viewed file"],
      ["Shift+↑ / ↓", "extend a line selection (drag or shift-click also select)"],
      ["C", "copy the selected lines (or the caret line)"],
    ],
    heading: "viewer",
  },
  {
    entries: [
      ["ctrl-t", "pin / unpin the current file as a tab"],
      ["ctrl-w", "close the active tab"],
      ["{ / }", "previous / next tab"],
    ],
    heading: "tabs",
  },
  {
    entries: [
      ["s", "scope picker: kinds, or drill into recent commits"],
      ["t", "theme switcher: filter, live-preview, apply"],
      ["w", "switch to another git worktree"],
      ["c", "toggle changes-only filter for the tree"],
      ["r", "re-run checks"],
    ],
    heading: "workspace",
  },
  {
    entries: [
      ["p", "toggle the problems panel"],
      ["ctrl-b", "toggle the file tree sidebar"],
      ["[ / ] / \\", "shrink (collapses past min) / grow / reset sidebar"],
    ],
    heading: "layout",
  },
  {
    entries: [
      ["e", "open in terminal editor (suspends TUI, --editor template)"],
      ["o", "open in GUI / IDE (renderer stays live, --ide template)"],
      ["Shift+F10", "context menu for the focused row or symbol (or right-click)"],
      ["?", "show all keybindings"],
      ["q", "quit (confirm with y)"],
    ],
    heading: "app",
  },
];
