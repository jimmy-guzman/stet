import type { ScrollBoxRenderable, TextRenderable } from "@opentui/core";
import { fg, StyledText } from "@opentui/core";
import { batch, createEffect, Index, Show } from "solid-js";

import { state } from "@/state";
import { useTheme } from "@/theme/context";
import { kindLetter } from "@/ui-helpers";
import { matchIndices } from "@/utils/fuzzy";
import { toCodePoints, truncateAroundMatch } from "@/utils/text";

import { FileIcon } from "./FileIcon";
import { RecencyDot } from "./TreeRow";

export function FileCombobox() {
  const theme = useTheme();
  let fileComboboxRef: ScrollBoxRenderable | undefined;

  createEffect(() => {
    fileComboboxRef?.scrollChildIntoView(`file-combobox-${state.fileComboboxIndex()}`);
  });

  // Opening a result is the same whether it comes from the input's submit (the
  // Highlighted row) or a click on a specific row.
  function openPath(path: string) {
    batch(() => {
      state.selectFile(path);
      state.setFocusedPane("diff");
      state.setFileComboboxOpen(false);
    });
  }

  function onSubmit() {
    const path = state.fileComboboxResults()[state.fileComboboxIndex()];
    if (path !== undefined) {
      openPath(path);
    } else {
      state.setFileComboboxOpen(false);
    }
  }

  function onInput(value: string) {
    batch(() => {
      state.setFileComboboxQuery(value);
      state.setFileComboboxIndex(0);
    });
  }

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
      <input
        focused
        width="100%"
        placeholder="go to file…"
        backgroundColor={theme.colors.surface.panel}
        focusedBackgroundColor={theme.colors.surface.panel}
        textColor={theme.colors.text.primary}
        focusedTextColor={theme.colors.text.primary}
        cursorColor={theme.colors.accent.primary}
        onInput={onInput}
        onSubmit={onSubmit}
      />
      <scrollbox
        ref={(el) => (fileComboboxRef = el)}
        width="100%"
        height={Math.min(12, Math.max(1, state.fileComboboxResults().length))}
        scrollY
        viewportCulling
        scrollbarOptions={{
          trackOptions: {
            backgroundColor: theme.rgba.transparent,
            foregroundColor: theme.colors.scrollbar.thumb,
          },
        }}
      >
        <Show
          when={state.fileComboboxResults().length > 0}
          fallback={
            <box id="file-combobox-empty" paddingLeft={1}>
              <text fg={theme.colors.text.muted}>no matches</text>
            </box>
          }
        >
          {/* Id-by-index is required: reordering results must never change a live renderable's id */}
          <Index each={state.fileComboboxResults()}>
            {(path, index) => {
              const changed = () => state.gitModel().changedByPath.get(path());
              const nameFg = () =>
                index === state.fileComboboxIndex()
                  ? theme.colors.text.selected
                  : changed() === undefined
                    ? theme.colors.text.secondary
                    : theme.colors.kind[changed()!.kind];
              // Keep the path on one line: the tail (filename + nearest dirs) is
              // The meaningful part of a match, so left-truncate to the overlay's
              // Interior width less border, padding, icon, and trailing badges.
              const maxPathLen = () => state.overlayWidth() - 7 - (state.iconsEnabled() ? 2 : 0);
              return (
                <box
                  id={`file-combobox-${index}`}
                  width="100%"
                  height={1}
                  overflow="hidden"
                  flexDirection="row"
                  justifyContent="space-between"
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={
                    index === state.fileComboboxIndex()
                      ? theme.colors.surface.cursor
                      : theme.colors.surface.panel
                  }
                  onMouseDown={() => openPath(path())}
                >
                  <box flexDirection="row">
                    <FileIcon name={path().split("/").at(-1) ?? path()} />
                    <HighlightedPath
                      path={path}
                      query={() => state.fileComboboxQuery()}
                      max={maxPathLen}
                      fg={nameFg}
                      matchFg={() => theme.colors.accent.primary}
                    />
                    <RecencyDot at={state.recencyByPath().get(path())} />
                  </box>
                  {changed() === undefined ? null : (
                    <text fg={theme.colors.stage[changed()!.stage]}>
                      {kindLetter(changed()!.kind)}
                    </text>
                  )}
                </box>
              );
            }}
          </Index>
        </Show>
      </scrollbox>
      <box height={1} paddingLeft={1} backgroundColor={theme.colors.surface.panel}>
        <text fg={theme.colors.text.muted}>↑↓ navigate · ⏎ open · esc close</text>
      </box>
    </box>
  );
}

// The result path on one line: truncated so the fuzzy match stays visible (its
// Matched characters are never clipped) and rendered as a single StyledText so
// Those characters can be accent-colored without one <text> per run. Mirrors
// CodeLine's imperative StyledText pattern; the row's overflow="hidden" is the
// Structural backstop against any wrap.
function HighlightedPath(props: {
  path: () => string;
  query: () => string;
  max: () => number;
  fg: () => string;
  matchFg: () => string;
}) {
  let ref: TextRenderable | undefined;
  createEffect(() => {
    if (ref === undefined) {
      return;
    }
    const display = truncateAroundMatch(
      props.path(),
      matchIndices(props.query(), props.path()),
      props.max(),
    );
    const highlighted = new Set(display.matched);
    const spans: { fg: string; text: string }[] = [];
    for (const [index, char] of toCodePoints(display.text).entries()) {
      const color = highlighted.has(index) ? props.matchFg() : props.fg();
      const last = spans.at(-1);
      if (last !== undefined && last.fg === color) {
        last.text += char;
      } else {
        spans.push({ fg: color, text: char });
      }
    }
    ref.content = new StyledText(
      (spans.length === 0 ? [{ fg: props.fg(), text: "" }] : spans).map((span) =>
        fg(span.fg)(span.text),
      ),
    );
  });
  return <text ref={(el) => (ref = el)} wrapMode="none" height={1} />;
}
