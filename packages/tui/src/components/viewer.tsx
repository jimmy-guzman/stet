import type { InputRenderable } from "@opentui/core";
import { batch, createEffect, Match, on, Show, Switch } from "solid-js";

import type { NavigableLine } from "@/diff/rows";
import { state } from "@/state";
import { theme } from "@/theme/context";
import {
  nearestNavigableIndex,
  placeholderText,
  viewerStats,
} from "@/ui-helpers";
import { truncateLeft } from "@/utils/text";
import type { Position } from "@/viewer/navigation";

import { BinaryPreview } from "./binary-preview";
import { DiffView } from "./diff/diff-view";
import { emptyStateTone } from "./focus-tone";
import { SearchPane } from "./search-pane";

const findRestoreIndex = (lines: NavigableLine[], position: Position) => {
  if (position.cursorLine === undefined) {
    return lines.findIndex((line) => line.type !== "context");
  }

  const side = position.cursorSide === "old" ? "oldLine" : "newLine";

  return lines.findIndex((line) => line[side] === position.cursorLine);
};

/** A restore without a line match homes to the nearest navigable line, or the top on a fresh open. */
const restoreIndex = (
  lines: { newLine?: number; oldLine?: number }[],
  found: number,
  cursorLine: number | undefined
) => {
  if (found !== -1) {
    return found;
  }

  return cursorLine === undefined
    ? 0
    : Math.max(0, nearestNavigableIndex(lines, cursorLine));
};

const displayedFile = () => {
  const view = state.diffView();

  return view === undefined
    ? undefined
    : state.gitModel().changedByPath.get(view.path);
};

const titleStats = () =>
  viewerStats(
    displayedFile(),
    state.diffView()?.showFileContent ?? false,
    state.diffView()?.fileContent
  );

// The stats never shrink, so the title side gets what they leave: the row's
// Padding (2) plus one gap cell between the two sides. Truncating to this, rather
// Than letting flex clip, keeps the filename end of the path and every stat.
const titleBudget = () => {
  const stats = titleStats();

  return Math.max(
    1,
    state.layout().viewer.content.width -
      2 -
      (stats === "" ? 0 : Bun.stringWidth(stats) + 1)
  );
};

const isPlaceholder = () => {
  const content = state.diffView()?.fileContent;

  return (
    state.diffView()?.showFileContent === true &&
    content !== undefined &&
    content.kind !== "text"
  );
};

// The metadata surface for a binary file, in either view mode: file-content mode
// Reads the single viewed side, diff mode the old/new sides. `undefined` for every
// Other content, so the placeholder line and DiffView keep their existing paths.
const binaryPreview = () => {
  const view = state.diffView();
  const content = view?.fileContent;

  if (view?.showFileContent === true && content?.kind === "binary") {
    return {
      diff: undefined,
      path: view.path,
      single: { bytes: content.bytes, image: content.image },
    };
  }

  return view?.binary === undefined
    ? undefined
    : { diff: view.binary, path: view.path, single: undefined };
};

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

const onFindInput = (value: string) => {
  batch(() => {
    state.setFindQuery(value);
    state.setFindMatchPos(0);
  });
};

const onFindSubmit = () => {
  batch(() => {
    const matches = state.findMatches();
    const [first] = matches;

    if (first !== undefined) {
      state.setFindMatchPos(0);
      state.goToFindMatch(first);
      state.setFindActive(true);
    }

    state.setFindOpen(false);
  });
};

export const Viewer = () => {
  let findInputRef: InputRenderable | undefined;

  // Resolve the current request against the loaded view. Navigation replaces the
  // request, so completion cannot consume an older jump after a new one arrives.
  createEffect(() => {
    const pending = state.pendingRestore();

    if (pending === undefined) {
      return;
    }

    const view = state.diffView();

    if (
      view?.path !== pending.path ||
      view.showFileContent !== state.showFileContent() ||
      view.full !== state.fullContentPaths().has(pending.path)
    ) {
      return;
    }

    const lines = state.navigableLines();
    const found = findRestoreIndex(lines, pending);

    if (found === -1 && state.revealRestoreTarget(pending, view.full)) {
      return;
    }

    // A fresh open homes to the first change. When the file has line changes yet
    // This snapshot shows none, the diff is still loading (an interrupted git read
    // Can briefly commit an empty patch); don't spend the one-shot restore on it,
    // The real diff re-fires this effect and lands on the change. A file with no
    // Change lines (binary, rename/mode-only) settles with none, so it still
    // Consumes at the top.
    const changed = state.selectedFile();

    const expectsChangeLines =
      changed !== undefined &&
      !changed.binary &&
      changed.additions + changed.deletions > 0;

    if (
      pending.cursorLine === undefined &&
      found === -1 &&
      !state.fileView() &&
      expectsChangeLines
    ) {
      return;
    }

    const index = restoreIndex(lines, found, pending.cursorLine);

    batch(() => {
      state.setCursorIndex(index);
      state.setViewerScrollTop(pending.viewport.scrollTop);
      state.setViewerScrollX(pending.viewport.scrollX);
      state.setRevealRange(undefined);

      if (found !== -1 && pending.jump?.column !== undefined) {
        state.revealMatch(index, pending.jump.column - 1, pending.jump.length);
      }

      state.setPendingRestore(undefined);
    });
  });

  // Clamp the cursor when a refresh shrinks the content under it.
  createEffect(() => {
    const last = state.navigableLines().length - 1;

    if (state.cursorIndex() > last) {
      state.setCursorRow(Math.max(0, last));
    }
  });

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
      }
    )
  );

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      onMouseDown={() => {
        state.setFocusedPane(state.viewerFocus());
      }}
    >
      {/* The main-area view switch: exactly one view owns the pane interior.
          The file view keeps its header/body/truncated rows as before; the
          search pane brings its own chrome. Future views extend the union. */}
      <Switch>
        <Match when={state.mainView() === "search"}>
          <SearchPane />
        </Match>
        <Match when={state.mainView() === "file"}>
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
                <text
                  fg={
                    state.focusedPane() === "diff"
                      ? theme.colors.text.primary
                      : theme.colors.text.secondary
                  }
                  wrapMode="none"
                >
                  {truncateLeft(state.selectedPath() ?? "", titleBudget())}
                </text>
                <text fg={theme.colors.text.muted} flexShrink={0}>
                  {titleStats() === "" ? "" : ` ${titleStats()}`}
                </text>
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
              {/* The find bar replaces the title row, so its prompt carries the focus mark. */}
              <text
                fg={
                  state.focusedPane() === "diff"
                    ? theme.colors.accent.primary
                    : theme.colors.text.muted
                }
              >
                {"/ "}
              </text>
              <box flexGrow={1}>
                <input
                  ref={(el: InputRenderable) => {
                    findInputRef = el;
                  }}
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
                {/* With nothing selected there is no title or caret to mark focus, so this
                line carries it. */}
                <text fg={emptyStateTone("diff")}>nothing to inspect</text>
                {/* An empty list during the deferred load is not yet an empty repository. */}
                <text fg={theme.colors.text.faint}>
                  {state.gitModel().repoFiles.length === 0 &&
                  !state.repoFilesLoading()
                    ? "this repository has no files yet"
                    : "select a file to inspect"}
                </text>
              </box>
            }
          >
            <Show
              when={binaryPreview()}
              fallback={
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
              }
            >
              {(preview) => (
                <BinaryPreview
                  path={preview().path}
                  height={state.viewerHeight()}
                  single={preview().single}
                  diff={preview().diff}
                />
              )}
            </Show>
          </Show>
          {/* A partially-loaded file reserves this row (viewerHeight already shrank by
          it) rather than crowding the transient status bar: the affordance sits at
          the content it describes. The whole row loads the rest, mirroring the `f`
          key. */}
          <Show when={state.truncated()}>
            <box
              ref={(el) => {
                el.selectable = false;
              }}
              height={1}
              flexDirection="row"
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={theme.colors.surface.panel}
              onMouseDown={() => {
                state.loadFullContent();
              }}
            >
              <text
                ref={(el) => {
                  el.selectable = false;
                }}
                fg={theme.colors.text.muted}
              >
                {`⋯ ${state.truncatedHidden()} more ${
                  state.truncatedHidden() === 1 ? "line" : "lines"
                } · f to load`}
              </text>
            </box>
          </Show>
        </Match>
      </Switch>
    </box>
  );
};
