import type { MouseEvent } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { createMemo, Index, Show } from "solid-js";

import { openInEditor } from "@/editor/open";
import { state } from "@/state";
import { useTheme } from "@/theme/context";
import type { CaretCell } from "@/viewer/anchor";
import { placeCard } from "@/viewer/anchor";

import type { CommandMenuItem } from "./command-menu/items";

const HINT = "↑↓ navigate · ⏎ run · esc close";

// The context menu, shared by the tree (App, global coordinates) and viewer
// (DiffView, viewer-content coordinates) instances. It is presentational: the
// Caller resolves the anchor cell and the viewport for its coordinate frame, and
// This computes a fit-to-content width, places itself with `placeCard` (below the
// Anchor, flipped above near the bottom edge, clamped on-screen), and dispatches a
// Row's action on click. The highlighted row carries a `▸` caret so the selection
// Reads under `NO_COLOR`. Inapplicable actions are omitted upstream, so every row acts.
export function CommandMenu(props: {
  anchor: () => CaretCell | undefined;
  viewportWidth: () => number;
  viewportHeight: () => number;
}) {
  const theme = useTheme();
  const renderer = useRenderer();

  const layout = createMemo(() => {
    const anchor = props.anchor();
    if (anchor === undefined) {
      return undefined;
    }
    const items = state.commandMenuItems();
    const inner = Math.max(HINT.length, ...items.map((item) => 2 + Bun.stringWidth(item.label)));
    // +2 border, +2 padding; capped so a menu never runs off a narrow pane.
    const width = Math.min(inner + 4, props.viewportWidth());
    const placement = placeCard({
      anchor,
      cardHeight: items.length + 3,
      cardWidth: width,
      viewportHeight: props.viewportHeight(),
      viewportWidth: props.viewportWidth(),
    });
    return { items, placement, width };
  });

  const run = (item: CommandMenuItem) => {
    const action = item.action;
    if (action.kind === "openEditor") {
      void openInEditor(renderer, action.path, action.line, action.mode);
    } else {
      state.dispatchCommandAction(action);
    }
    state.closeCommandMenu();
  };

  return (
    <Show when={layout()}>
      {(value) => (
        <box
          position="absolute"
          top={value().placement.top}
          left={value().placement.left}
          width={value().width}
          flexDirection="column"
          borderStyle="single"
          borderColor={theme.colors.border.focused}
          backgroundColor={theme.colors.surface.panel}
          zIndex={100}
        >
          <Index each={value().items}>
            {(item, index) => {
              const highlighted = () => index === state.commandMenuIndex();
              return (
                <box
                  ref={(el) => (el.selectable = false)}
                  width="100%"
                  height={1}
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={
                    highlighted() ? theme.colors.surface.cursor : theme.colors.surface.panel
                  }
                  onMouseDown={(event: MouseEvent) => {
                    event.stopPropagation();
                    run(item());
                  }}
                >
                  <text fg={highlighted() ? theme.colors.text.selected : theme.colors.text.strong}>
                    {`${highlighted() ? "▸ " : "  "}${item().label}`}
                  </text>
                </box>
              );
            }}
          </Index>
          <box height={1} paddingLeft={1} backgroundColor={theme.colors.surface.panel}>
            <text fg={theme.colors.text.muted}>{HINT}</text>
          </box>
        </box>
      )}
    </Show>
  );
}
