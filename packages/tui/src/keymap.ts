import type { KeyEvent } from "@opentui/core";
import { batch } from "solid-js";

import { scopeKinds } from "./cli";
import { formatCopyReference } from "./clipboard/reference";
import { HORIZONTAL_STEP } from "./diff/follow";
import { latestActivity } from "./git/activity";
import type { KeyActionId } from "./keys/actions";
import { matchesKey } from "./keys/combo";
import { combosFor } from "./keys/registry";
import { state } from "./state";
import { isNavigableSearchItem } from "./viewer/search-items";

/**
 * The injection seam for the keymap's irreversible host side-effects (`quit` tears down the
 * renderer and exits the process; `openInEditor` suspends/resumes it around a subprocess). Both
 * need the `renderer` (a render-tree resource that must not leak into the global `state`
 * singleton), and injection keeps the otherwise-pure keymap testable without a real renderer or
 * `process.exit`. Data actions never belong here; they live in `state`.
 */
interface HostEffects {
  quit: () => void;
  openInEditor: (
    path: string,
    line: number | undefined,
    mode: "terminal" | "ide"
  ) => Promise<void>;
}

const cycleFind = (direction: number) => {
  const matches = state.findMatches();

  if (matches.length === 0) {
    return;
  }

  const pos =
    (state.findMatchPos() + direction + matches.length) % matches.length;

  const target = matches[pos];

  if (target !== undefined) {
    state.setFindMatchPos(pos);
    state.goToFindMatch(target);
  }
};

// Open the scope picker on the kinds level, reading as "where am I now": on the
// Active kind, or the "commits" drill-down row when a commit scope is active (its
// SHA is not a top-level kind, so indexOf is a benign -1).
const openScopeMenu = () => {
  state.setScopeMenuView("kinds");
  state.setScopeMenuIndex(
    state.scope().kind === "commit"
      ? scopeKinds.length
      : Math.max(0, scopeKinds.indexOf(state.scope().kind))
  );
  state.setScopeMenuOpen(true);
};

/** Everything one keypress's handlers read: the event, the host seam, and the binding matcher. */
interface KeyContext {
  key: KeyEvent;
  host: HostEffects;
  pressed: (id: KeyActionId) => boolean;
}

/** One step of the chain; returning `true` consumes the key and stops every later step. */
type KeyStep = (ctx: KeyContext) => boolean;

/**
 * A rebindable action at a fixed chain position. `when` gates it on top of the combo: a pressed
 * combo whose gate is closed falls through to the next binding, exactly like the inline
 * `pressed(id) && condition` it replaces.
 */
interface Binding {
  id: KeyActionId;
  when?: () => boolean;
  run: (ctx: KeyContext) => void;
}

/**
 * Tries the bindings in order and runs the first pressed one whose gate is open.
 *
 * @returns A chain step that consumes the key only when a binding ran.
 */
const runBindings =
  (bindings: readonly Binding[]): KeyStep =>
  (ctx) => {
    const binding = bindings.find(
      ({ id, when }) => ctx.pressed(id) && (when?.() ?? true)
    );

    binding?.run(ctx);

    return binding !== undefined;
  };

const fileViewShowing = () => state.mainView() === "file";

const caretLineNumber = () => {
  const line = state.navigableLines()[state.cursorIndex()];

  return line?.newLine ?? line?.oldLine;
};

// Ctrl-c stays hardcoded ahead of everything: the deliberate, documented
// Escape hatch must survive any rebinding.
const handleCtrlC: KeyStep = ({ key, host }) => {
  if (key.ctrl && key.name === "c") {
    host.quit();

    return true;
  }

  return false;
};

// The quit confirm owns the keyboard while open; ctrl-c above still exits
// Instantly, so the deliberate escape hatch is never gated behind it.
const handleQuitConfirm: KeyStep = ({ key, host }) => {
  if (!state.quitConfirmOpen()) {
    return false;
  }

  if (key.name === "y" || key.name === "return") {
    host.quit();
  } else if (key.name === "escape" || key.name === "n") {
    state.setQuitConfirmOpen(false);
  }

  return true;
};

const handleHelpDialog: KeyStep = ({ key }) => {
  if (!state.helpDialogOpen()) {
    return false;
  }

  if (key.name === "escape" || key.name === "?" || key.name === "q") {
    state.setHelpDialogOpen(false);
  } else if (key.name === "tab") {
    state.setHelpView(state.helpView() === "keys" ? "marks" : "keys");
  }

  return true;
};

// The worktree picker owns the keyboard while open (like the palette): nav
// Here, text and submit (the switch) are the input element's job. Escape
// Closes; enter (the input's onSubmit) switches to the highlighted worktree.
const handleWorktreeCombobox: KeyStep = ({ key }) => {
  if (!state.worktreeComboboxOpen()) {
    return false;
  }

  if (key.name === "escape") {
    state.setWorktreeComboboxOpen(false);
  } else if (key.name === "down" || (key.ctrl && key.name === "n")) {
    state.setWorktreeComboboxIndex(
      Math.min(
        state.worktreeComboboxIndex() + 1,
        Math.max(0, (state.worktreeComboboxResults()?.length ?? 0) - 1)
      )
    );
  } else if (key.name === "up" || (key.ctrl && key.name === "p")) {
    state.setWorktreeComboboxIndex(
      Math.max(state.worktreeComboboxIndex() - 1, 0)
    );
  }

  return true;
};

const applyScopeMenuSelection = (inCommits: boolean) => {
  if (inCommits) {
    // Only close on a real selection; Enter on a loading/empty list is a no-op.
    if (state.selectCommit(state.scopeMenuIndex())) {
      state.setScopeMenuOpen(false);
    }

    return;
  }

  const kind = scopeKinds[state.scopeMenuIndex()];

  if (kind !== undefined) {
    state.selectScope(kind);
  }

  state.setScopeMenuOpen(false);
};

const handleScopeMenu: KeyStep = ({ key }) => {
  if (!state.scopeMenuOpen()) {
    return false;
  }

  const inCommits = state.scopeMenuView() === "commits";

  // Level 1 is the kinds plus a trailing "commits" drill-down row (at index
  // ScopeKinds.length); level 2 is the loaded commit list.
  const lastIndex = inCommits
    ? Math.max(0, state.commits().length - 1)
    : scopeKinds.length;

  const onCommitsRow =
    !inCommits && state.scopeMenuIndex() === scopeKinds.length;

  if (key.name === "escape" || (key.name === "left" && inCommits)) {
    // Esc (or left) backs out of the drill-down first, then closes the picker.
    if (inCommits) {
      state.setScopeMenuView("kinds");
      state.setScopeMenuIndex(scopeKinds.length);
    } else {
      state.setScopeMenuOpen(false);
    }
  } else if (key.name === "s") {
    // `s` opened the picker, so it closes it from either level.
    state.setScopeMenuOpen(false);
  } else if (key.name === "j" || key.name === "down") {
    state.setScopeMenuIndex(Math.min(state.scopeMenuIndex() + 1, lastIndex));
  } else if (key.name === "k" || key.name === "up") {
    state.setScopeMenuIndex(Math.max(state.scopeMenuIndex() - 1, 0));
  } else if ((key.name === "return" || key.name === "right") && onCommitsRow) {
    // Drill into the commit list rather than applying a scope.
    state.setScopeMenuView("commits");
    state.setScopeMenuIndex(0);
    state.loadCommits(state.gitModel().repoRoot);
  } else if (key.name === "return") {
    applyScopeMenuSelection(inCommits);
  }

  return true;
};

// The context menu owns the keyboard while open (it can cover either pane, so
// It gates ahead of the pane-specific branches). j/k/arrows move the highlight;
// Return runs the highlighted action (editor opens through the host, like e/o).
const handleCommandMenu: KeyStep = ({ key, host }) => {
  if (!state.commandMenuOpen()) {
    return false;
  }

  const items = state.commandMenuItems();

  if (key.name === "escape") {
    state.closeCommandMenu();
  } else if (key.name === "j" || key.name === "down") {
    state.setCommandMenuIndex(
      Math.min(state.commandMenuIndex() + 1, items.length - 1)
    );
  } else if (key.name === "k" || key.name === "up") {
    state.setCommandMenuIndex(Math.max(state.commandMenuIndex() - 1, 0));
  } else if (key.name === "return") {
    const item = items[state.commandMenuIndex()];

    if (item !== undefined) {
      if (item.action.kind === "openEditor") {
        void host.openInEditor(
          item.action.path,
          item.action.line,
          item.action.mode
        );
      } else {
        state.dispatchCommandAction(item.action);
      }
    }

    state.closeCommandMenu();
  }

  return true;
};

const handleFileCombobox: KeyStep = ({ key }) => {
  if (!state.fileComboboxOpen()) {
    return false;
  }

  if (key.name === "escape") {
    state.setFileComboboxOpen(false);
  } else if (key.name === "down" || (key.ctrl && key.name === "n")) {
    state.setFileComboboxIndex(
      Math.min(
        state.fileComboboxIndex() + 1,
        Math.max(0, state.fileComboboxResults().length - 1)
      )
    );
  } else if (key.name === "up" || (key.ctrl && key.name === "p")) {
    state.setFileComboboxIndex(Math.max(state.fileComboboxIndex() - 1, 0));
  }

  return true;
};

// The theme picker owns the keyboard while open (like the palette): nav here
// Previews live, text/submit are the input's job. Escape reverts to the
// Theme open captured; enter (the input's onSubmit) commits the highlighted one.
const handleThemeCombobox: KeyStep = ({ key }) => {
  if (!state.themeComboboxOpen()) {
    return false;
  }

  if (key.name === "escape") {
    state.closeThemePicker(false);
  } else if (key.ctrl && key.name === "s") {
    // Commit the previewed theme first so the session and the file land on
    // The same value, then save every divergent setting with it.
    state.closeThemePicker(true);
    void state.persistSettings();
  } else if (key.name === "down" || (key.ctrl && key.name === "n")) {
    state.setThemeComboboxIndex(
      Math.min(
        state.themeComboboxIndex() + 1,
        Math.max(0, state.themeComboboxResults().length - 1)
      )
    );
  } else if (key.name === "up" || (key.ctrl && key.name === "p")) {
    state.setThemeComboboxIndex(Math.max(state.themeComboboxIndex() - 1, 0));
  }

  return true;
};

// Toggle chords live on keys the input's readline set does not own
// (ctrl-a/ctrl-e stay line home/end for editing): ctrl-r regex,
// Ctrl-x exact case, ctrl-g changes<->repo, ctrl-o the scope picker,
// Ctrl-s save settings.
const searchChords = new Map<string, () => void>([
  [
    "r",
    () => {
      state.toggleSearchRegex();
    },
  ],
  [
    "x",
    () => {
      state.toggleSearchCase();
    },
  ],
  [
    "g",
    () => {
      state.toggleSearchScope();
    },
  ],
  // The diff scope (which changes what "changed" means) is pickable without
  // Leaving the pane; the ScopeMenu branch earlier in the chain owns the
  // Keys once open, and a pick reruns the search via the git-model dep.
  // Ctrl-o, not ctrl-s: one key means one thing, and ctrl-s saves settings
  // Everywhere.
  ["o", openScopeMenu],
  // This input-owning branch swallows unmatched keys, so the global save
  // Below is repeated here rather than reached by fallthrough.
  [
    "s",
    () => {
      void state.persistSettings();
    },
  ],
]);

/** The search view's keys shared by every sub-focus: esc, the tab cycle, and the toggle chords. */
const handleSearchChrome: KeyStep = ({ key }) => {
  if (key.name === "escape") {
    state.closeSearch();

    return true;
  }

  if (key.name === "tab") {
    // The focused input would swallow the tab as text otherwise.
    key.preventDefault();
    const order = ["query", "glob", "results"] as const;
    const step = key.shift ? -1 : 1;
    const at = order.indexOf(state.searchFocus());
    state.setSearchFocus(
      order[(at + step + order.length) % order.length] ?? "query"
    );

    return true;
  }

  const chord = key.ctrl ? searchChords.get(key.name) : undefined;
  chord?.();

  return chord !== undefined;
};

// Query/glob focus: down enters the results; ctrl-b still reaches the
// Sidebar (VS Code precedent, preventDefault stops the input's
// Move-left); ctrl-p falls through to the palette; everything else
// Is the input's (its readline chords included).
const handleSearchInput: KeyStep = ({ key }) => {
  if (key.name === "down" || (key.ctrl && key.name === "n")) {
    state.setSearchFocus("results");

    return true;
  }

  if (key.ctrl && key.name === "b") {
    key.preventDefault();
    state.toggleSidebar();

    return true;
  }

  return !(key.ctrl && key.name === "p");
};

const handleSearchResultMoves: KeyStep = ({ key }) => {
  if (
    key.name === "j" ||
    key.name === "down" ||
    (key.ctrl && key.name === "n")
  ) {
    state.moveSearchSelection(1);

    return true;
  }

  if (key.name === "k" || key.name === "up" || (key.ctrl && key.name === "p")) {
    // At the first navigable row, up returns to the query field.
    const current = state.searchIndex();

    const previous = state
      .searchItems()
      .findLastIndex(
        (item, index) => index < current && isNavigableSearchItem(item)
      );

    if (previous === -1) {
      state.setSearchFocus("query");
    } else {
      state.moveSearchSelection(-1);
    }

    return true;
  }

  if (key.ctrl && key.name === "d") {
    state.pageSearchSelection(1);

    return true;
  }

  if (key.ctrl && key.name === "u") {
    state.pageSearchSelection(-1);

    return true;
  }

  return false;
};

const handleSearchResultGroups: KeyStep = ({ key }) => {
  const item = state.searchItems()[state.searchIndex()];

  if (key.name === "return") {
    if (item?.kind === "header") {
      state.toggleSearchGroup(item.path);
    } else {
      state.jumpToSearchItem(state.searchIndex());
    }

    return true;
  }

  if (
    key.name === "h" ||
    key.name === "left" ||
    key.name === "l" ||
    key.name === "right"
  ) {
    if (item !== undefined && item.kind !== "gap") {
      const collapse = key.name === "h" || key.name === "left";
      // A visible line row means its group is expanded; only headers can
      // Already be collapsed.
      const collapsed = item.kind === "header" && item.collapsed;

      if (collapse !== collapsed) {
        state.toggleSearchGroup(item.path);
      }
    }

    return true;
  }

  return false;
};

const handleSearchResultEnds: KeyStep = ({ key }) => {
  const items = state.searchItems();

  if (key.name === "g" && !key.shift) {
    const first = items.findIndex(isNavigableSearchItem);

    if (first !== -1) {
      state.setSearchSelection(first);
    }

    return true;
  }

  if (key.name === "G" || (key.name === "g" && key.shift)) {
    const last = items.findLastIndex(isNavigableSearchItem);

    if (last !== -1) {
      state.setSearchSelection(last);
    }

    return true;
  }

  return false;
};

// E/o and y retarget from the hidden viewer to the selected result: open
// It in the editor, or copy its reference.
// Unshifted only, so Shift+O falls through to the external-open binding
// Rather than opening the highlighted result in the IDE.
const handleSearchResultTargets: KeyStep = ({ key, host }) => {
  const item = state.searchItems()[state.searchIndex()];

  if ((key.name === "e" || key.name === "o") && !key.shift) {
    if (item !== undefined && item.kind !== "gap") {
      void host.openInEditor(
        item.path,
        item.kind === "line" ? item.line : undefined,
        key.name === "e" ? "terminal" : "ide"
      );
    }

    return true;
  }

  if (key.name === "y" && !key.shift) {
    if (item?.kind === "header") {
      state.copy(formatCopyReference({ path: item.path }));
    } else if (item?.kind === "line") {
      state.copy(
        formatCopyReference({
          line: item.line,
          path: item.path,
        })
      );
    }

    return true;
  }

  return false;
};

// Unhandled in results focus: fall through to the global bindings.
const searchResultSteps: readonly KeyStep[] = [
  handleSearchResultMoves,
  handleSearchResultGroups,
  handleSearchResultEnds,
  handleSearchResultTargets,
];

// The search view's sub-focus routing while it is the focused pane: esc,
// The tab cycle, and the query toggles are handled for every sub-focus;
// Text and submit (the jump) are the input elements' job (like the
// Palette). Only the input sub-focuses swallow the remaining keys (they
// Own printable characters); results focus has no input, so unhandled
// Keys fall through and the global bindings (q, ?, ctrl-p...) keep
// Working. With the tree focused, keys fall
// Through to the tree branch while the view stays on screen.
const handleSearchPane: KeyStep = (ctx) => {
  if (state.mainView() !== "search" || state.focusedPane() !== "search") {
    return false;
  }

  if (handleSearchChrome(ctx)) {
    return true;
  }

  if (state.searchFocus() !== "results") {
    return handleSearchInput(ctx);
  }

  return searchResultSteps.some((step) => step(ctx));
};

// The find bar owns the keyboard while open: only escape cancels it; text
// And submit are the input element's job (same split as the palette).
const handleFindBar: KeyStep = ({ key }) => {
  if (!state.findOpen()) {
    return false;
  }

  if (key.name === "escape") {
    state.resetFind();
  }

  return true;
};

// A committed find rebinds n/N to cycle matches and esc to clear it; every
// Other key falls through so diff navigation still works over the highlights.
const handleCommittedFind: KeyStep = ({ key }) => {
  if (!state.findActive()) {
    return false;
  }

  if (key.name === "escape") {
    state.resetFind();

    return true;
  }

  if (key.name === "n" && !key.shift) {
    cycleFind(1);

    return true;
  }

  if (key.name === "N" || (key.name === "n" && key.shift)) {
    cycleFind(-1);

    return true;
  }

  return false;
};

// A selection is dismiss-on-esc, after a committed find (which dismisses first);
// The cursor stays where the selection's focus was.
const handleSelectionEscape: KeyStep = ({ key }) => {
  if (state.viewerSelection() !== undefined && key.name === "escape") {
    state.clearSelection();

    return true;
  }

  return false;
};

// The viewer's committed-find and selection keys, claimed before the global esc.
// One gate for all of them: with the search view up they would act on a viewer
// That isn't on screen, and a selection left there swallowed the esc that closes
// Search (#409).
const handleViewerKeys: KeyStep = (ctx) =>
  fileViewShowing() && (handleCommittedFind(ctx) || handleSelectionEscape(ctx));

const leadingGlobalBindings: readonly Binding[] = [
  {
    id: "go-to-file",
    run: () => {
      state.openFileCombobox();
    },
  },
  // Opens (or refocuses) the search view; the query and results persist, so
  // Reopening after a jump restores the result set instead of clearing it.
  {
    id: "search",
    run: () => {
      state.openSearch();
    },
  },
  // Only while the file view is showing: the find bar's input lives inside
  // The Viewer's file branch, so opening it under the search view would
  // Focus an unmounted input and wedge the keyboard.
  {
    id: "find",
    run: ({ key }) => {
      // Solid mounts and focuses the find input within this same key event, so
      // Without preventDefault a printable triggering key would be typed into it.
      key.preventDefault();
      state.resetFind();
      state.setFindOpen(true);
      state.setFocusedPane("diff");
    },
    when: () => state.diffView() !== undefined && fileViewShowing(),
  },
  {
    id: "quit",
    run: () => {
      state.setQuitConfirmOpen(true);
    },
  },
];

// Esc only ever closes: the search view left on screen with the tree
// Focused, then nothing. Esc never quits; quitting is Q, which raises the
// Confirm above.
const handleGlobalEscape: KeyStep = ({ key }) => {
  if (key.name !== "escape") {
    return false;
  }

  if (state.mainView() === "search") {
    state.closeSearch();
  }

  return true;
};

const globalBindings: readonly Binding[] = [
  {
    id: "switch-pane",
    run: () => {
      state.focusNextPane();
    },
  },
  // Ctrl-b (not a plain b) so the toggle also works while the search pane's
  // Inputs own the printable keys.
  {
    id: "toggle-sidebar",
    run: () => {
      state.toggleSidebar();
    },
  },
  // Resize the focused pane along its dock axis. Every one self-guards on that
  // Pane's own open state, so there is no gate here: grow re-opens a collapsed
  // Sidebar, and shrink/reset are no-ops on a pane that is already closed.
  {
    id: "grow-pane",
    run: () => {
      state.growPane();
    },
  },
  {
    id: "shrink-pane",
    run: () => {
      state.shrinkPane();
    },
  },
  {
    id: "reset-pane",
    run: () => {
      state.resetPane();
    },
  },
  // Self-guarding (a closed pane does not move), and nothing later claims `d`.
  {
    id: "move-pane",
    run: () => {
      state.movePane();
    },
  },
  {
    id: "zoom-pane",
    run: () => {
      state.toggleZoom();
    },
  },
  {
    id: "help",
    run: () => {
      state.setHelpView("keys");
      state.setHelpDialogOpen(true);
    },
  },
  {
    id: "worktrees",
    run: ({ key }) => {
      // Solid mounts and focuses the picker's filter input within this same key
      // Event, so without preventDefault a printable trigger would be typed into it.
      key.preventDefault();
      state.openWorktreePicker();
    },
  },
  { id: "scope", run: openScopeMenu },
  {
    id: "theme",
    run: ({ key }) => {
      // Solid mounts and focuses the picker's filter input within this same key
      // Event, so without preventDefault a printable trigger would be typed into it.
      key.preventDefault();
      state.openThemePicker();
    },
  },
  // Save the session's settings to the user config.
  {
    id: "save-settings",
    run: () => {
      void state.persistSettings();
    },
  },
  {
    id: "changes-only",
    run: () => {
      const current = state.changesOnly();
      state.setChangesOnly(!current);
      state.notify(current ? "all files" : "changes only");
    },
  },
  {
    id: "toggle-wrap",
    run: () => {
      const wrapping = state.overflow() === "wrap";
      state.setOverflow(wrapping ? "scroll" : "wrap");
      state.notify(wrapping ? "wrap off" : "wrap on");
    },
    when: fileViewShowing,
  },
  {
    id: "latest-file",
    run: () => {
      const latest = latestActivity(state.activityLog());

      if (latest !== undefined) {
        state.selectFile(latest.path);
      }
    },
  },
  {
    id: "back",
    run: () => {
      state.goBack();
    },
  },
  {
    id: "forward",
    run: () => {
      state.goForward();
    },
  },
  // Open the context menu on the focused pane (Shift+F10, the IDE-standard "show
  // Context menu" key). The tree menu works from tree focus; the viewer menu only
  // While the file view is on screen (its copy actions need a caret).
  {
    id: "context-menu",
    run: () => {
      const pane = state.focusedPane();

      if (pane === "tree") {
        state.openCommandMenu("tree");
      } else if (pane === "diff" && fileViewShowing()) {
        state.openCommandMenu("viewer");
      }
    },
  },
];

/** The file-view actions that act on the selected file's path. */
const handleSelectedFile = (
  { pressed, host }: KeyContext,
  selectedPath: string
) => {
  if (pressed("toggle-view") && state.selectedFile() !== undefined) {
    state.toggleFileView();

    return true;
  }

  if (pressed("load-full")) {
    state.loadFullContent();

    return true;
  }

  if (pressed("open-editor")) {
    void host.openInEditor(selectedPath, caretLineNumber(), "terminal");

    return true;
  }

  // Open externally defaults to the ide opener's Shift pair (bare uppercase, so the
  // Modifier survives terminals that drop Shift on control keys). Gated on
  // FileViewShowing like the sibling single-file actions.
  if (pressed("open-external")) {
    state.openExternally(selectedPath);

    return true;
  }

  if (pressed("open-ide")) {
    void host.openInEditor(selectedPath, caretLineNumber(), "ide");

    return true;
  }

  return false;
};

// File-view keys act only while the file view is on screen: with the
// Search view up they would mutate or read a viewer the user cannot see
// (the results branch above retargets e/o/y to the selected result).
const handleFileView: KeyStep = (ctx) => {
  if (!fileViewShowing()) {
    return false;
  }

  const selectedPath = state.selectedPath();

  if (selectedPath !== undefined && handleSelectedFile(ctx, selectedPath)) {
    return true;
  }

  // Copy-reference is registered `global` but is really pane-dispatched: it reads
  // Whichever pane holds focus, choosing between the tree and the viewer. It stays
  // One action id (one rebind, one help row) rather than a per-pane id, which the
  // Conflict detector would report against the global binding anyway, since a
  // Global action claims its combo in every pane scope.
  if (ctx.pressed("copy-text")) {
    state.copyText();

    return true;
  }

  return false;
};

const handleCopyReference: KeyStep = ({ pressed }) => {
  if (!pressed("copy-reference")) {
    return false;
  }

  if (state.focusedPane() === "tree") {
    const row = state.focusedTreeRow();

    if (row !== undefined) {
      state.copy(formatCopyReference({ path: row.node.path }));
    }

    return true;
  }

  const selectedPath = state.selectedPath();

  if (selectedPath !== undefined && fileViewShowing()) {
    state.copy(
      formatCopyReference({ ...state.referenceLines(), path: selectedPath })
    );
  }

  return true;
};

const lastNavigableLine = () => state.navigableLines().length - 1;

const halfPage = () => Math.max(1, Math.floor(state.viewerHeight() / 2));

// The selection extenders sit ahead of the plain moves (which clear any
// Selection); the default Shift+arrows are disjoint from the bare arrows.
const diffBindings: readonly Binding[] = [
  {
    id: "select-down",
    run: () => {
      state.extendSelectionRow(1);
    },
  },
  {
    id: "select-up",
    run: () => {
      state.extendSelectionRow(-1);
    },
  },
  {
    id: "select-right",
    run: () => {
      state.extendSelectionColumn(1);
    },
  },
  {
    id: "select-left",
    run: () => {
      state.extendSelectionColumn(-1);
    },
  },
  {
    id: "cursor-down",
    run: () => {
      state.setCursorRow(
        Math.max(0, Math.min(state.cursorIndex() + 1, lastNavigableLine()))
      );
    },
  },
  {
    id: "cursor-up",
    run: () => {
      state.setCursorRow(Math.max(state.cursorIndex() - 1, 0));
    },
  },
  {
    id: "half-page-down",
    run: () => {
      state.setCursorRow(
        Math.max(
          0,
          Math.min(state.cursorIndex() + halfPage(), lastNavigableLine())
        )
      );
    },
  },
  {
    id: "half-page-up",
    run: () => {
      state.setCursorRow(Math.max(state.cursorIndex() - halfPage(), 0));
    },
  },
  {
    id: "first-line",
    run: () => {
      state.setCursorRow(0);
    },
  },
  {
    id: "last-line",
    run: () => {
      state.setCursorRow(Math.max(0, lastNavigableLine()));
    },
  },
  {
    id: "scroll-right",
    run: () => {
      state.scrollViewerX(HORIZONTAL_STEP);
    },
  },
  {
    id: "scroll-left",
    run: () => {
      state.scrollViewerX(-HORIZONTAL_STEP);
    },
  },
  // Fold/unfold the region at the caret (an indent block or a git-elided gap).
  {
    id: "fold",
    run: () => {
      state.toggleRegionAtCaret();
    },
  },
];

/** The viewer pane's tail swallows every key that reaches it, bound or not. */
const handleDiffPane: KeyStep = (ctx) => {
  if (state.focusedPane() !== "diff") {
    return false;
  }

  runBindings(diffBindings)(ctx);

  return true;
};

const treeBindings: readonly Binding[] = [
  {
    id: "focus-down",
    run: () => {
      state.moveFocus("next");
    },
  },
  {
    id: "focus-up",
    run: () => {
      state.moveFocus("previous");
    },
  },
  {
    id: "expand",
    run: () => {
      state.moveFocus("right");
    },
  },
  {
    id: "collapse",
    run: () => {
      state.moveFocus("left");
    },
  },
  {
    id: "open",
    run: () => {
      state.activateTreeNode();
    },
  },
  {
    id: "first-item",
    run: () => {
      state.moveFocus("first");
    },
  },
  {
    id: "last-item",
    run: () => {
      state.moveFocus("last");
    },
  },
];

/**
 * The modal-precedence chain, in order (help > worktree > palette > global > pane-specific). The
 * order is load-bearing: an open overlay must swallow keys before any later step can act on them,
 * so the first step that returns `true` ends the keypress.
 */
const keyChain: readonly KeyStep[] = [
  handleCtrlC,
  handleQuitConfirm,
  handleHelpDialog,
  handleWorktreeCombobox,
  handleScopeMenu,
  handleCommandMenu,
  handleFileCombobox,
  handleThemeCombobox,
  handleSearchPane,
  handleFindBar,
  handleViewerKeys,
  runBindings(leadingGlobalBindings),
  handleGlobalEscape,
  runBindings(globalBindings),
  handleFileView,
  handleCopyReference,
  handleDiffPane,
  runBindings(treeBindings),
];

/**
 * One handler routes every key through the modal-precedence chain (`keyChain`). Reads use the live
 * signal values (not a render snapshot); writes are wrapped in one `batch` so a keypress is one
 * update.
 *
 * @returns A handler that processes key events and updates application state.
 */
export const createKeyHandler = (host: HostEffects) => (key: KeyEvent) => {
  // The rebindable layers (globals and the pane tails) dispatch through the
  // Keybinding registry; `pressed` is the one seam between a key event and an
  // Action id. The modal overlay chain above them stays hardcoded: overlay
  // Keys are a shared convention, not bindings. Exact modifier matching in
  // MatchesKey replaces the old per-site !shift/!ctrl exclusion guards.
  const pressed = (id: KeyActionId) =>
    combosFor(id).some((combo) => matchesKey(key, combo));

  const ctx = { host, key, pressed };
  batch(() => {
    keyChain.some((step) => step(ctx));
  });
};
