import type { MouseEvent } from "@opentui/core";
import { batch, createMemo, createSignal, Index, Show } from "solid-js";

import { horizontalDock } from "@/layout/regions";
import { state } from "@/state";
import { theme } from "@/theme/context";
import { createDoubleClickGuard } from "@/utils/double-click";

import { emptyStateTone } from "./focus-tone";
import { ListScrollbar } from "./list-scrollbar";
import { isLeftClick, pressHistoryButton } from "./mouse";
import { hoverable } from "./pointer";
import { TreeRow } from "./tree-row";
import { windowWheelHandler } from "./wheel";

const viewport = () => state.layout().sidebar.content.height;

const dividerBorder = () => {
  const side = state.layout().sidebar.divider;

  return side === undefined ? false : [side];
};

// The divider is the pane's own border, the one cell of it no child covers, so a hit whose target is
// The pane itself landed on the divider.
const onDivider = (event: MouseEvent) =>
  event.target !== null && event.target === event.currentTarget;

const resizePointer = () =>
  horizontalDock(state.sidebarPosition()) ? "col-resize" : "row-resize";

export const Sidebar = () => {
  // A drag resizes only when its press landed on the divider: a text selection or a drag whose
  // Pressed row closed can also cross the divider, and neither is a resize.
  const [resizing, setResizing] = createSignal(false);
  const isDoubleClick = createDoubleClickGuard();

  const divider = hoverable((event, pane) =>
    event.target === pane ? resizePointer() : undefined
  );

  const onMouseDown = (event: MouseEvent) => {
    // With the context menu open, a left press only closes it (the app's root does that), as one
    // Anywhere does.
    if (
      pressHistoryButton(event) ||
      (isLeftClick(event) && state.commandMenuOpen())
    ) {
      return;
    }

    batch(() => {
      state.setFocusedPane("tree");

      if (!isLeftClick(event) || !onDivider(event)) {
        return;
      }

      // Keyed by cell, so grabbing the divider again where a drag left it is not a double-click.
      if (isDoubleClick(`${event.x},${event.y}`)) {
        state.resetPane();

        return;
      }

      setResizing(true);
    });
  };

  const endResize = () => {
    setResizing(false);
  };

  // Window the tree to its viewport, the SearchPane pattern: only ~viewport
  // TreeRow renderables ever exist, so a 100k-file repo mounts and scrolls at
  // The same cost as a small one. The cursor-follow and clamp live in state.
  const visibleRows = createMemo(() => {
    const start = state.sidebarScrollTop();

    return state.treeSlice(start, viewport());
  });

  const onWheel = windowWheelHandler({
    rowCount: state.treeRowCount,
    scrollTop: state.sidebarScrollTop,
    setScrollTop: (next) => {
      state.setSidebarScrollTop(next);
    },
    viewport,
  });

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      ref={divider.ref}
      border={dividerBorder()}
      borderColor={
        divider.hovered() || resizing()
          ? theme.colors.border.focused
          : theme.colors.border.unfocused
      }
      backgroundColor={theme.colors.surface.base}
      onMouseDown={onMouseDown}
      onMouseDrag={(event: MouseEvent) => {
        if (resizing()) {
          state.resizePaneTo(event);
        }
      }}
      onMouseDragEnd={endResize}
      onMouseUp={endResize}
    >
      <box
        width="100%"
        height={viewport()}
        flexDirection="row"
        onMouseScroll={onWheel}
      >
        <box flexGrow={1} flexDirection="column">
          <Show
            when={state.treeRowCount() > 0}
            fallback={
              // No rows yet. During the deferred repoFiles load, render no text: the
              // Window is already a fixed viewport, so the pane stays reserved on its
              // Own. Only a loaded, file-less repo gets the real empty state.
              // A focused tree still shows an empty cursor band on its first row as its
              // Focus mark until the rows load.
              <Show
                when={!state.repoFilesLoading()}
                fallback={
                  <Show when={state.focusedPane() === "tree"}>
                    <box
                      id="tree-loading-cursor"
                      width="100%"
                      height={1}
                      backgroundColor={theme.colors.surface.cursor}
                    />
                  </Show>
                }
              >
                <box
                  id="tree-empty"
                  width="100%"
                  height={viewport()}
                  flexDirection="column"
                  justifyContent="center"
                  alignItems="center"
                  backgroundColor={theme.colors.surface.base}
                >
                  {/* With no rows there is no cursor row to mark focus, so this line carries it. */}
                  <text fg={emptyStateTone("tree")}>no files</text>
                  <text fg={theme.colors.text.faint}>
                    this repository has no files yet
                  </text>
                </box>
              </Show>
            }
          >
            <Index each={visibleRows()}>
              {(row) => <TreeRow row={row()} />}
            </Index>
          </Show>
        </box>
        <ListScrollbar
          rowCount={state.treeRowCount}
          viewport={viewport}
          scrollTop={state.sidebarScrollTop}
          setScrollTop={(next) => {
            state.setSidebarScrollTop(next);
          }}
        />
      </box>
    </box>
  );
};
