import { existsSync } from "node:fs";

import type { MouseEvent, Selection, ThemeMode } from "@opentui/core";
import {
  useKeyboard,
  useRenderer,
  useTerminalDimensions,
} from "@opentui/solid";
import { createEffect, onCleanup, Show } from "solid-js";

import "./components/static-text";
import { CommandMenu } from "./components/command-menu";
import { FileCombobox } from "./components/file-combobox";
import { HeaderBar } from "./components/header-bar";
import { HelpDialog } from "./components/help-dialog";
import { pointerStyle, trackPointer } from "./components/pointer";
import { QuitConfirm } from "./components/quit-confirm";
import { ScopeMenu } from "./components/scope-menu";
import { Sidebar } from "./components/sidebar";
import { StatusBar } from "./components/status-bar";
import { ThemeCombobox } from "./components/theme-combobox";
import { Viewer } from "./components/viewer";
import { WorktreeCombobox } from "./components/worktree-combobox";
import { registerWidthMethod } from "./diff/cells";
import { openInEditor } from "./editor/open";
import type { Worktree } from "./git/worktree";
import { createKeyHandler } from "./keymap";
import type { LogLevel } from "./log/levels";
import { exitAfterRestore } from "./shutdown";
import { state } from "./state";
import { setAppearance } from "./theme/active";
import { theme } from "./theme/context";
import { refreshTerminalPalette, syncTerminalPalette } from "./theme/system";
import { worktreeLabel } from "./ui-helpers";
import { formatUpdateNotice } from "./upgrade/release";

/**
 * A bar's backdrop: a rule across its row, with a tee where a side-docked divider meets it. The bar's
 * text paints over it on its own surface, so the bar is the border and costs no row of its own (a
 * rule in a row of its own always shows a blank strip beside the line, since a glyph fills its cell).
 */
const ruleLine = (width: number, tee: string) => {
  const { junction } = state.layout();

  return junction === undefined
    ? "─".repeat(width)
    : `${"─".repeat(junction)}${tee}${"─".repeat(Math.max(0, width - junction - 1))}`;
};

// Follow the terminal's appearance at runtime: when the OS flips dark/light
// Mid-session, the renderer emits theme_mode and the reactive theme state
// Re-themes the UI and re-renders the diff with the new palette.
const onThemeMode = (mode: ThemeMode | null) => {
  if (mode !== null) {
    setAppearance(mode);
  }
};

// Text outside the viewer is selected by OpenTUI itself (the viewer's rows are windowed, so it owns
// Its selection); a released drag copies it, as one in the viewer does. A plain click on selectable
// Text also lands here, with nothing selected.
const onNativeSelection = (selection: Selection) => {
  const text = selection.getSelectedText();

  if (text === "") {
    return;
  }

  state.clearSelection();
  state.copyCharacters(text);
};

export const App = () => {
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();

  createEffect(() => {
    state.setTerminalWidth(dimensions().width);
    state.setTerminalHeight(dimensions().height);
  });

  renderer.on("theme_mode", onThemeMode);
  // Startup read the mode before its palette probe and theme import, and a flip
  // In that window emitted with no listener, so take the current mode now.
  onThemeMode(renderer.themeMode);
  // The renderer re-reads the terminal palette after a mode flip (and on resume)
  // And publishes it here, so `system` follows the terminal's own theme change.
  // A flip during startup found no listener and left the palette unread, so read
  // It once now.
  renderer.on("palette", refreshTerminalPalette);
  void syncTerminalPalette(renderer);

  // The terminal's answer about how it counts cells can land after the first paint.
  const syncWidthMethod = () => {
    registerWidthMethod(renderer.widthMethod);
  };

  syncWidthMethod();
  renderer.on("capabilities", syncWidthMethod);
  renderer.on("selection", onNativeSelection);
  onCleanup(() => {
    renderer.off("capabilities", syncWidthMethod);
    renderer.off("selection", onNativeSelection);
    renderer.off("theme_mode", onThemeMode);
    renderer.off("palette", refreshTerminalPalette);
  });

  // A read-only TUI should not show a stray terminal cursor outside its inputs.
  // The renderer shows one by default, so hide it whenever no input overlay is
  // Open (each input shows its own caret while focused); `autoFocus: false` on the
  // Renderer keeps a click from re-showing it by focusing the clicked renderable.
  createEffect(() => {
    const inputFocused =
      state.fileComboboxOpen() ||
      (state.mainView() === "search" &&
        state.focusedPane() === "search" &&
        state.searchFocus() !== "results") ||
      state.themeComboboxOpen() ||
      state.worktreeComboboxOpen() ||
      state.findOpen();

    if (!inputFocused) {
      renderer.setCursorPosition(0, 0, false);
    }
  });

  /**
   * The git poll runs on the shared runtime, not the render tree, and keeps the event loop alive, so
   * quitting tears down the screen and exits rather than waiting for the loop to drain.
   */
  const quit = (message?: { text: string; level: LogLevel }) => {
    void exitAfterRestore(renderer, 0, message);
  };

  // The user-initiated quit (keyboard) surfaces a pending update on the way out, gh-style. The
  // Worktree-recovery exit reports its degraded shutdown through the same path; the crash/signal
  // Backstops in main.tsx never route here.
  const quitWithUpdateNotice = () => {
    const update = state.availableUpdate();
    quit(
      update === undefined
        ? undefined
        : { level: "info", text: formatUpdateNotice(update) }
    );
  };

  // The heartbeat flags a deleted current worktree; recover by switching to the
  // Main worktree (the parent repo), or exit cleanly when it too is gone.
  createEffect(() => {
    if (!state.currentWorktreeDeleted()) {
      return;
    }

    const main = state.mainWorktreePath();
    const root = state.gitModel().repoRoot;

    // The flag can outlive its cause (a fresh model was seeded, or we already
    // Switched away). Act only while something is genuinely gone.
    if (existsSync(root) && (main === "" || existsSync(main))) {
      state.setCurrentWorktreeDeleted(false);

      return;
    }

    // The main worktree survives and isn't where we already are: switch to it.
    if (main !== "" && main !== root && existsSync(main)) {
      const cached = state
        .worktrees()
        ?.find((worktree) => worktree.path === main);

      const label =
        cached === undefined
          ? (main.split("/").pop() ?? main)
          : worktreeLabel(cached);

      const target: Worktree = cached ?? {
        bare: false,
        detached: false,
        head: "",
        locked: false,
        path: main,
        prunable: false,
      };

      // Nobody asked for this switch, so it has to announce itself; a warning, because losing the
      // Worktree under you is a degraded condition, not a routine move.
      void state.switchWorktree(target, {
        label,
        successNotice: {
          level: "warning",
          text: `worktree deleted, switched to ${label}`,
        },
      });

      return;
    }

    // Nothing recoverable: the repository itself is gone. A clean exit (code 0) of a
    // Degraded condition reads as a warning, not a crash.
    quit({
      level: "warning",
      text: "stet: worktree deleted, nothing left to inspect",
    });
  });

  // The terminal's pointer follows what is under it. OSC 22 goes out with a frame, and a pointer
  // Move alone may not cause one.
  createEffect(() => {
    renderer.setMousePointer(pointerStyle());
    renderer.requestRender();
  });

  // OpenTUI inverts selected cells unless it is given colors; text outside the viewer wears the
  // Viewer's selection, under the primary text color, since the faint tiers would vanish into it.
  createEffect(() => {
    renderer.setSelectionColors(
      theme.colors.selection.bg,
      theme.colors.text.primary
    );
  });

  // One highlight at a time: a selection in the viewer replaces one OpenTUI holds elsewhere, as
  // `onNativeSelection` does the other way round.
  createEffect(() => {
    if (state.viewerSelection() !== undefined) {
      renderer.clearSelection();
    }
  });

  const handleKey = createKeyHandler({
    openInEditor: async (file, line, mode) => {
      await openInEditor(renderer, file, line, mode);
    },
    quit: quitWithUpdateNotice,
  });

  useKeyboard((key) => {
    if (key.name === "escape") {
      renderer.clearSelection();
    }

    handleKey(key);
  });

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={theme.colors.surface.base}
      onMouseMove={trackPointer}
      onMouseOver={trackPointer}
      onMouseDown={() => {
        // A press nothing claimed (a bar, a blank stretch of a pane) closes the context menu, as
        // A press on any target does.
        state.closeCommandMenu();
      }}
    >
      {/* Every region is placed at the rect `computeLayout` returned, in terminal
          cells. Nothing here re-derives a position or a size, so a pane that docks
          to another edge moves by changing the model's input, not this markup. */}
      <box
        position="absolute"
        left={state.layout().header.x}
        top={state.layout().header.y}
        width={state.layout().header.width}
        height={state.layout().header.height}
      >
        <text
          position="absolute"
          left={0}
          top={0}
          selectable={false}
          wrapMode="none"
          fg={theme.colors.border.unfocused}
        >
          {ruleLine(state.layout().header.width, "┬")}
        </text>
        <HeaderBar />
      </box>
      <Show when={state.layout().sidebar.width > 0}>
        <box
          position="absolute"
          left={state.layout().sidebar.x}
          top={state.layout().sidebar.y}
          width={state.layout().sidebar.width}
          height={state.layout().sidebar.height}
        >
          <Sidebar />
        </box>
      </Show>
      {/* Gated like the other two panes: zoom gives one pane the whole band and leaves
          the rest a zero rect, and a zero-sized box still paints its frame, which stamped
          a collapsed `┌┐` over the header. The viewer used to be exempt only because it
          was the center and always had a rect. */}
      <Show when={state.layout().viewer.width > 0}>
        <box
          position="absolute"
          left={state.layout().viewer.x}
          top={state.layout().viewer.y}
          width={state.layout().viewer.width}
          height={state.layout().viewer.height}
        >
          <Viewer />
        </box>
      </Show>
      <box
        position="absolute"
        left={state.layout().status.x}
        top={state.layout().status.y}
        width={state.layout().status.width}
        height={state.layout().status.height}
      >
        <text
          position="absolute"
          left={0}
          top={0}
          selectable={false}
          wrapMode="none"
          fg={theme.colors.border.unfocused}
        >
          {ruleLine(state.layout().status.width, "┴")}
        </text>
        <StatusBar />
      </box>
      {/* Under the browsing overlays: a press outside one lands here and closes it, rather than
          acting on the pane behind, and the wheel stops here too. Transparent, so the panes
          still show; the quit confirm brings its own scrim and never closes this way. */}
      <Show when={state.browsingOverlayOpen()}>
        <box
          position="absolute"
          left={0}
          top={0}
          width="100%"
          height="100%"
          backgroundColor={theme.rgba.transparent}
          zIndex={99}
          onMouseDown={(event: MouseEvent) => {
            event.stopPropagation();
            state.dismissOverlay();
          }}
        />
      </Show>
      <Show when={state.fileComboboxOpen()}>
        <FileCombobox />
      </Show>
      <Show when={state.worktreeComboboxOpen()}>
        <WorktreeCombobox />
      </Show>
      <Show when={state.scopeMenuOpen()}>
        <ScopeMenu />
      </Show>
      {/* Every context menu but the caret's anchors in global terminal coordinates
          (the viewer's own instance lives inside DiffView, in viewer-content space). */}
      <Show
        when={
          state.commandMenuOpen() && state.commandMenuContext() !== "viewer"
        }
      >
        <CommandMenu
          anchor={() => {
            const at = state.commandMenuAnchor();

            return at === undefined ? undefined : { col: at.x, row: at.y };
          }}
          viewportWidth={state.terminalWidth}
          viewportHeight={state.terminalHeight}
        />
      </Show>
      <Show when={state.themeComboboxOpen()}>
        <ThemeCombobox />
      </Show>
      <Show when={state.helpDialogOpen()}>
        <HelpDialog />
      </Show>
      <Show when={state.quitConfirmOpen()}>
        <QuitConfirm onQuit={quitWithUpdateNotice} />
      </Show>
    </box>
  );
};
