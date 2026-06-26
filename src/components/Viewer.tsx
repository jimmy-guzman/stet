import type { InputRenderable } from "@opentui/core";
import { batch, createEffect, createMemo, on, Show } from "solid-js";

import { state } from "../state";
import { useTheme } from "../theme/context";
import { nearestNavigableIndex, placeholderText, viewerTitle } from "../ui-helpers";
import { DiffView } from "./diff/DiffView";

export function Viewer() {
  const theme = useTheme();
  let findInputRef: InputRenderable | undefined;

  // Reset the cursor to the first change only when the displayed file changes,
  // Not on live edits of the same file. Keyed through a memo so it fires once per
  // Path change, not on every diffView commit (the plain->highlighted upgrade
  // Commits twice for the same path, and Solid's `on` does not value-dedupe).
  const loadedPath = createMemo(() => state.diffView()?.path);
  createEffect(
    on(loadedPath, () => {
      const first = state.navigableLines().findIndex((line) => line.type !== "context");
      state.setCursorIndex(first === -1 ? 0 : first);
    }),
  );

  // Clamp the cursor when a refresh shrinks the content under it.
  createEffect(() => {
    const last = state.navigableLines().length - 1;
    if (state.cursorIndex() > last) {
      state.setCursorIndex(Math.max(0, last));
    }
  });

  // Deferred jumps (problem/recency navigation): land on the line, un-truncate,
  // Or escalate to file view to find it.
  createEffect(() => {
    const jump = state.jumpTarget();
    if (jump === undefined || jump.path !== state.selectedPath()) {
      return;
    }
    // Only resolve once the loaded snapshot matches the current target AND view
    // Intent. `selectedPath`/`fileView` update synchronously, but `diffView`
    // (which feeds `navigableLines`) loads async; acting on a stale snapshot
    // Consumes the jump against the wrong content and never lands on the line.
    // The `showFileContent` check is what makes escalation work: after the jump
    // Flips to file view, it waits for the full content instead of clearing
    // Itself against the still-loaded diff.
    const view = state.diffView();
    if (view?.path !== jump.path || view.showFileContent !== state.showFileContent()) {
      return;
    }
    const lines = state.navigableLines();
    const index = lines.findIndex((line) => line.newLine === jump.line);
    if (index !== -1) {
      state.setCursorIndex(index);
      state.setJumpTarget(undefined);
      return;
    }
    if (state.truncated() && !state.fullContentPaths().has(jump.path)) {
      state.setFullContentPaths((current) => new Set(current).add(jump.path));
      return;
    }
    if (jump.escalate && state.selectedFile() !== undefined && !state.fileView()) {
      state.setFileView(true);
      return;
    }
    const nearest = nearestNavigableIndex(lines, jump.line);
    if (nearest >= 0) {
      state.setCursorIndex(nearest);
    }
    state.setJumpTarget(undefined);
  });

  const focused = () => state.focusedPane() === "diff";
  const displayedFile = () => {
    const view = state.diffView();
    return view === undefined ? undefined : state.gitModel().changedByPath.get(view.path);
  };
  const isPlaceholder = () => {
    const content = state.diffView()?.fileContent;
    return (
      state.diffView()?.showFileContent === true && content !== undefined && content.kind !== "text"
    );
  };

  // The input stays mounted whenever the bar shows so a committed (blurred) find
  // Never captures the n/N cycle keys; `focused` follows findOpen. Each open
  // Clears the element's own buffer to match the freshly-reset query.
  createEffect(
    on(
      () => state.findOpen(),
      (open) => {
        if (open && findInputRef !== undefined) {
          findInputRef.value = "";
        }
      },
    ),
  );

  const findCounter = () => {
    if (state.findQuery() === "") {
      return "";
    }
    const count = state.findMatches().length;
    if (count === 0) {
      return "no matches";
    }
    // Clamp: a live edit during an active find can leave the position past the end.
    return `${Math.min(state.findMatchPos(), count - 1) + 1}/${count}`;
  };

  function onFindInput(value: string) {
    batch(() => {
      state.setFindQuery(value);
      state.setFindMatchPos(0);
    });
  }

  function onFindSubmit() {
    batch(() => {
      const matches = state.findMatches();
      const first = matches[0];
      if (first !== undefined) {
        state.setFindMatchPos(0);
        state.setCursorIndex(first);
        state.setFindActive(true);
      }
      state.setFindOpen(false);
    });
  }

  return (
    <box
      flexGrow={1}
      height="100%"
      flexDirection="column"
      borderStyle="single"
      borderColor={focused() ? theme.colors.border.focused : theme.colors.border.unfocused}
      onMouseDown={() => state.setFocusedPane("diff")}
    >
      <Show
        when={state.findOpen() || state.findActive()}
        fallback={
          <box
            height={1}
            flexDirection="row"
            justifyContent="space-between"
            paddingLeft={1}
            paddingRight={1}
          >
            <text fg={theme.colors.text.primary}>
              {viewerTitle(
                state.diffView()?.path,
                displayedFile(),
                state.diffView()?.showFileContent ?? false,
                state.diffView()?.fileContent,
              )}
            </text>
            <box flexDirection="row">
              {/* Keep the active scope legible at the diff, so a staged/unstaged
                  view is never misread as the whole change. */}
              <Show when={state.scope().kind !== "all"}>
                <text
                  fg={
                    state.scope().kind === "staged"
                      ? theme.colors.stage.staged
                      : theme.colors.stage.unstaged
                  }
                >
                  {`${state.scope().kind} · `}
                </text>
              </Show>
              <text fg={theme.colors.text.muted}>
                {state.diffView()?.showFileContent ? "file" : "diff"}
                {state.cursorLineNumber() === undefined ? "" : ` · ln ${state.cursorLineNumber()}`}
              </text>
            </box>
          </box>
        }
      >
        {/* While searching, the title row becomes a full-width find bar. */}
        <box
          height={1}
          flexDirection="row"
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={theme.colors.surface.panel}
        >
          <text fg={theme.colors.accent.primary}>{"/ "}</text>
          <box flexGrow={1}>
            <input
              ref={(el: InputRenderable) => (findInputRef = el)}
              focused={state.findOpen()}
              width="100%"
              backgroundColor={theme.colors.surface.panel}
              focusedBackgroundColor={theme.colors.surface.panel}
              textColor={theme.colors.text.primary}
              focusedTextColor={theme.colors.text.primary}
              cursorColor={theme.colors.accent.primary}
              onInput={onFindInput}
              onSubmit={onFindSubmit}
            />
          </box>
          <text fg={theme.colors.text.muted}>
            {findCounter() === "" ? "" : `${findCounter()}  `}
          </text>
          <text fg={theme.colors.text.faint}>esc</text>
        </box>
      </Show>
      {/* Nothing is selectable (an empty repository, or selection cleared):
          author that void instead of a blank pane. A selected-but-not-yet-loaded
          file keeps rendering the diff surface below, so a load never flashes
          this; that is why the guard is selectedPath, not the async diffView. */}
      <Show
        when={state.selectedPath() !== undefined}
        fallback={
          <box
            height={state.viewerHeight()}
            flexDirection="column"
            justifyContent="center"
            alignItems="center"
          >
            <text fg={theme.colors.text.muted}>nothing to inspect</text>
            <text fg={theme.colors.text.faint}>
              {state.gitModel().repoFiles.length === 0
                ? "this repository has no files yet"
                : "select a file to inspect"}
            </text>
          </box>
        }
      >
        <Show
          when={!isPlaceholder()}
          fallback={
            <box height={state.viewerHeight()} paddingLeft={1}>
              <text fg={theme.colors.text.muted}>
                {placeholderText(state.diffView()?.fileContent)}
              </text>
            </box>
          }
        >
          <DiffView />
        </Show>
      </Show>
    </box>
  );
}
