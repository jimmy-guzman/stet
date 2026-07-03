import type { ScrollBoxRenderable } from "@opentui/core";
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js";

import { highlightSnippet, languageForPath } from "@/diff/engine";
import type { RenderSpan } from "@/diff/hast";
import { levelColor, levelGlyph } from "@/log/levels";
import { state } from "@/state";
import { activeThemeName } from "@/theme/active";
import { useTheme } from "@/theme/context";

import { CodeLine } from "./CodeLine";
import { FileIcon } from "./FileIcon";

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

  // Each preview is one scattered source line, so it highlights as a standalone
  // Snippet keyed by result index; a new result set or a theme flip clears the
  // Cache, and rows upgrade plain -> highlighted in place (identical text, so the
  // Swap never shifts layout), the same contract the search pane uses.
  const [spanCache, setSpanCache] = createSignal(new Map<number, RenderSpan[]>());
  createEffect(() => {
    results();
    activeThemeName();
    setSpanCache(new Map());
  });
  createEffect(() => {
    // Re-highlight on a theme flip too: the clear effect above empties the cache
    // On `activeThemeName()`, and this effect must re-run to refill it (it reads no
    // Cache signal that would otherwise retrigger it), or previews strand on plain.
    activeThemeName();
    if (state.referencesStatus() !== "ready") {
      return;
    }
    const cancelled = { current: false };
    onCleanup(() => {
      cancelled.current = true;
    });
    results().forEach((match, index) => {
      void highlightSnippet(match.text, languageForPath(match.path)).then((lines) => {
        if (!cancelled.current) {
          setSpanCache((previous) =>
            new Map(previous).set(index, lines[0] ?? [{ text: match.text }]),
          );
        }
      });
    });
  });
  const rowSpans = (index: number, text: string): RenderSpan[] =>
    spanCache().get(index) ?? [{ text }];

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
                  <box flexDirection="row" paddingLeft={1} paddingRight={1}>
                    <FileIcon name={match.path.split("/").at(-1) ?? match.path} />
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
                  <CodeLine
                    spans={() => rowSpans(index(), match.text)}
                    width={() => Math.max(8, state.overlayWidth() - locWidth() - 6)}
                  />
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
