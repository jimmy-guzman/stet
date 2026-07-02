import type { ScrollBoxRenderable } from "@opentui/core";
import { createEffect, createMemo, For, Show } from "solid-js";

import { levelColor, levelGlyph } from "@/log/levels";
import { state } from "@/state";
import { useTheme } from "@/theme/context";
import { truncate } from "@/utils/text";

// A query-less palette-family overlay: the results list for `textDocument/references`
// (and go-to-definition's multi-result case). Mirrors the FileCombobox's chrome minus
// The input; every status (loading/empty/error/ready) is a designed screen so it never
// Shows a blank pane, and the box grows in place rather than reflowing the diff beneath it.
export function ReferencesOverlay() {
  const theme = useTheme();
  let listRef: ScrollBoxRenderable | undefined;

  createEffect(() => {
    listRef?.scrollChildIntoView(`references-${state.referencesIndex()}`);
  });

  const results = () => state.referencesResults();
  const fileCount = createMemo(() => new Set(results().map((match) => match.path)).size);
  // Pad `line:col` to the widest in the set so the previews start at the same cell; a
  // Monospace column is free, so the list reads as a table rather than a ragged edge.
  const locWidth = createMemo(() =>
    results().reduce((max, match) => Math.max(max, `${match.line}:${match.column}`.length), 0),
  );
  const summary = () => {
    const count = results().length;
    return `${count} ${state.referencesLabel()} in ${fileCount()} file${fileCount() === 1 ? "" : "s"}`;
  };

  return (
    <box
      position="absolute"
      left={state.overlayLeft()}
      top={1}
      width={state.overlayWidth()}
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.colors.border.focused}
      backgroundColor={theme.colors.surface.panel}
      zIndex={100}
    >
      <box height={1} paddingLeft={1} paddingRight={1}>
        <text fg={theme.colors.text.strong}>{state.referencesLabel()}</text>
      </box>
      <Show when={state.referencesStatus() === "loading"}>
        <box height={1} paddingLeft={1} paddingRight={1}>
          <text fg={theme.colors.text.muted}>{`finding ${state.referencesLabel()}…`}</text>
        </box>
      </Show>
      <Show when={state.referencesStatus() === "empty"}>
        <box height={1} paddingLeft={1} paddingRight={1}>
          <text fg={theme.colors.text.muted}>{`no ${state.referencesLabel()}`}</text>
        </box>
      </Show>
      <Show when={state.referencesStatus() === "error"}>
        <box height={1} paddingLeft={1} paddingRight={1}>
          <text
            fg={levelColor(theme.colors, "error")}
          >{`${levelGlyph("error")} language server unreachable`}</text>
        </box>
      </Show>
      <Show when={state.referencesStatus() === "ready"}>
        <scrollbox
          ref={(el) => (listRef = el)}
          width="100%"
          height={Math.min(14, Math.max(1, results().length + fileCount()))}
          scrollY
          viewportCulling
          scrollbarOptions={{
            trackOptions: {
              backgroundColor: theme.rgba.transparent,
              foregroundColor: theme.colors.scrollbar.thumb,
            },
          }}
        >
          {/* Result index is the cursor space; a file header renders above the first
              match of each file. Ids by index so reordering never moves a live id. */}
          <For each={results()}>
            {(match, index) => (
              <box width="100%" flexDirection="column">
                <Show when={index() === 0 || results()[index() - 1]?.path !== match.path}>
                  <box paddingLeft={1} paddingRight={1}>
                    <text fg={theme.colors.text.strong}>{match.path}</text>
                  </box>
                </Show>
                <box
                  id={`references-${index()}`}
                  // Non-selectable so a click on the row jumps without starting a text
                  // Selection (a stray highlight), the way the viewer's diff rows do.
                  ref={(el) => (el.selectable = false)}
                  width="100%"
                  flexDirection="row"
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={
                    index() === state.referencesIndex()
                      ? theme.colors.surface.cursor
                      : theme.colors.surface.panel
                  }
                  onMouseDown={() => state.jumpToReference(index())}
                >
                  <text fg={theme.colors.text.muted}>
                    {`${`${match.line}:${match.column}`.padEnd(locWidth())}  `}
                  </text>
                  <text
                    fg={
                      index() === state.referencesIndex()
                        ? theme.colors.text.selected
                        : theme.colors.text.secondary
                    }
                  >
                    {truncate(match.text, Math.max(8, state.overlayWidth() - locWidth() - 6))}
                  </text>
                </box>
              </box>
            )}
          </For>
        </scrollbox>
      </Show>
      <box height={1} paddingLeft={1} paddingRight={1}>
        <text fg={theme.colors.text.muted}>
          {state.referencesStatus() === "ready" ? summary() : ""}
        </text>
      </box>
      <box height={1} paddingLeft={1} backgroundColor={theme.colors.surface.panel}>
        <text fg={theme.colors.text.muted}>↑↓ navigate · ⏎ open · esc close</text>
      </box>
    </box>
  );
}
