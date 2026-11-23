import { createMemo, Index, Show } from "solid-js";

import { state } from "@/state";
import { theme } from "@/theme/context";

import { emptyStateTone } from "./focus-tone";
import { ListScrollbar } from "./list-scrollbar";
import { TreeRow } from "./tree-row";
import { windowWheelHandler } from "./wheel";

const viewport = () => state.layout().sidebar.content.height;

const dividerBorder = () => {
  const side = state.layout().sidebar.divider;

  return side === undefined ? false : [side];
};

export const Sidebar = () => {
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
      border={dividerBorder()}
      borderColor={theme.colors.border.unfocused}
      backgroundColor={theme.colors.surface.base}
      onMouseDown={() => {
        state.setFocusedPane("tree");
      }}
    >
      <box
        width="100%"
        height={viewport()}
        flexDirection="row"
        onMouseScroll={onWheel}
      >
        <box
          ref={(el) => {
            // A click activates a row; it must never start a text selection.
            el.selectable = false;
          }}
          flexGrow={1}
          flexDirection="column"
        >
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
        />
      </box>
    </box>
  );
};
