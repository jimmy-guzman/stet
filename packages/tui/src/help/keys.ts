import type { KeyActionId } from "@/keys/actions";
import { comboTextsFor } from "@/keys/registry";

/**
 * The one keybindings registry for display: the source of truth for the in-app `?` overlay
 * (`HelpDialog`), `--help` (`keyBindingsHelp` in `src/cli.ts`), and, via `script/gen-docs-keys.ts`,
 * the docs keybindings reference. Rows reference action ids from `src/keys/actions.ts` and render
 * their _current_ combos, so a config rebind shows up in `?` and `--help` (the generated docs carry
 * the defaults). A row whose every action is unbound disappears rather than advertising a dead key.
 * Overlay-internal keys (picker navigation, the quit confirm) are documented by each overlay's own
 * hint row, not here.
 */
const KEY_HELP_GROUPS: {
  entries: { actions: readonly [KeyActionId, ...KeyActionId[]]; description: string }[];
  heading: string;
}[] = [
  {
    entries: [
      {
        actions: [
          "focus-down",
          "focus-up",
          "cursor-down",
          "cursor-up",
          "problem-down",
          "problem-up",
        ],
        description: "move in the tree, viewer, or problems panel",
      },
      {
        actions: ["collapse", "expand", "caret-prev", "caret-next"],
        description: "collapse / expand folders (tree) or hop the caret by word (viewer)",
      },
      { actions: ["switch-pane"], description: "switch focus between tree and viewer" },
      {
        actions: ["open", "open-problem"],
        description: "open the focused item / jump to a problem",
      },
      { actions: ["go-to-file"], description: "go to file: fuzzy-search the whole repo" },
      { actions: ["latest-file"], description: "jump to the most recently changed file" },
      { actions: ["next-finding"], description: "jump to the next file with findings" },
    ],
    heading: "navigation",
  },
  {
    entries: [
      { actions: ["find"], description: "find in the viewer; n/N cycle matches, esc clears" },
      { actions: ["search"], description: "project search pane; regex/case/scope/glob toggles" },
      { actions: ["toggle-view"], description: "toggle diff ↔ full file view for a changed file" },
      { actions: ["fold"], description: "fold / unfold the region at the caret" },
      { actions: ["toggle-wrap"], description: "toggle long-line wrap in the viewer" },
      { actions: ["provenance"], description: "toggle the line provenance rail" },
      { actions: ["load-full"], description: "load full content when truncated" },
      {
        actions: ["half-page-down", "half-page-up"],
        description: "half-page cursor movement in the viewer",
      },
      { actions: ["first-line", "last-line"], description: "jump to first / last line" },
      {
        actions: ["go-to-definition"],
        description: "go to definition of the symbol under the caret",
      },
      {
        actions: ["find-references"],
        description: "find references to the symbol under the caret",
      },
      {
        actions: ["implementations"],
        description: "find implementations of the symbol under the caret",
      },
      {
        actions: ["call-hierarchy"],
        description: "call hierarchy of the symbol (Tab flips direction)",
      },
      { actions: ["hover"], description: "hover: type and docs for the symbol under the caret" },
      { actions: ["symbols"], description: "find symbols: outline of the open file" },
      { actions: ["back", "forward"], description: "back / forward through viewer history" },
      {
        actions: ["copy-reference"],
        description: "copy path (tree), path:line:col (viewer), or the selected result / problem",
      },
      {
        actions: ["copy-file"],
        description: "copy the file (viewer) or every entry (problems)",
      },
      {
        actions: ["select-up", "select-down"],
        description: "extend a line selection (drag also selects)",
      },
      { actions: ["copy-selection"], description: "copy the selected lines (or the caret line)" },
    ],
    heading: "viewer",
  },
  {
    entries: [
      { actions: ["pin-tab"], description: "pin / unpin the current file as a tab" },
      { actions: ["close-tab"], description: "close the active tab" },
      { actions: ["prev-tab", "next-tab"], description: "previous / next tab" },
    ],
    heading: "tabs",
  },
  {
    entries: [
      { actions: ["scope"], description: "scope picker: kinds, or drill into recent commits" },
      { actions: ["theme"], description: "theme switcher: filter, live-preview, apply" },
      { actions: ["worktrees"], description: "switch to another git worktree" },
      { actions: ["changes-only"], description: "toggle changes-only filter for the tree" },
      { actions: ["save-settings"], description: "save current settings to config" },
      { actions: ["run-checks"], description: "re-run diagnostics" },
      { actions: ["restart-servers"], description: "restart language servers" },
    ],
    heading: "workspace",
  },
  {
    entries: [
      { actions: ["problems"], description: "toggle the problems panel" },
      { actions: ["toggle-sidebar"], description: "toggle the file tree sidebar" },
      {
        actions: ["shrink-sidebar", "grow-sidebar", "reset-sidebar"],
        description: "shrink (collapses past min) / grow (reopens) / reset sidebar",
      },
    ],
    heading: "layout",
  },
  {
    entries: [
      {
        actions: ["open-editor"],
        description: "open in terminal editor (suspends TUI, --editor template)",
      },
      {
        actions: ["open-ide"],
        description: "open in GUI / IDE (renderer stays live, --ide template)",
      },
      {
        actions: ["open-external"],
        description: "open externally in the OS default app (images, PDFs, binaries)",
      },
      {
        actions: ["context-menu"],
        description: "context menu for the focused row or symbol (or right-click)",
      },
      { actions: ["help"], description: "show all keybindings" },
      { actions: ["quit"], description: "quit (confirm with y)" },
    ],
    heading: "app",
  },
];

/**
 * @returns The help groups with each row's combo column rendered from the live registry: the
 *   primary (first) combo of each referenced action, deduped and joined `g / G` style. Rows whose
 *   actions are all unbound are dropped.
 */
export function keyHelpGroups() {
  return KEY_HELP_GROUPS.map((group) => ({
    entries: group.entries
      .map((entry) => ({
        combo: joinCombos([
          ...new Set(
            entry.actions
              .map((id) => comboTextsFor(id)[0])
              .filter((text): text is string => text !== undefined),
          ),
        ]),
        description: entry.description,
        ids: entry.actions,
      }))
      .filter((entry) => entry.combo !== ""),
    heading: group.heading,
  }));
}

// A row whose combos all share one modifier prefix compresses it out of the
// Tail ("Shift+↑ / Shift+↓" reads as "Shift+↑ / ↓"), keeping the combo column
// Narrow; mixed rows join in full.
function joinCombos(texts: string[]) {
  const parts = texts.map((text) => /^(?<mod>(?:ctrl|shift)[+-])(?<key>.+)$/i.exec(text));
  const mod = parts[0]?.groups?.mod;
  const compressible =
    texts.length > 1 &&
    mod !== undefined &&
    parts.every((part) => part?.groups?.mod === mod && part.groups.key !== undefined);
  return compressible
    ? `${mod}${parts.map((part) => part?.groups?.key ?? "").join(" / ")}`
    : texts.join(" / ");
}
