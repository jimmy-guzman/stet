import { createMemo, For, Show } from "solid-js";

import { keyHelpGroups } from "@/help/keys";
import { legendGroups } from "@/help/legend";
import { state } from "@/state";
import { useTheme } from "@/theme/context";

import packageJson from "../../package.json";

// Minimum width of the left column box (the key combo or, on the marks view, the glyph); the
// Description wraps in whatever remains of the row. A reserved-width box (not string padding) keeps
// The right column aligned even on rows whose description wraps to a second line. It widens to the
// Longest rendered left cell (a rebind can exceed `Shift+F12`), or that cell wraps and the height
// Calc (which counts only description wraps) undercounts and clips a row.
const COMBO_WIDTH = 11;

// Word-wrapped line count of `text` at display `width` (matches OpenTUI's word
// Wrap). Widths are display columns via `Bun.stringWidth`, not code units, so a
// Wide glyph counts correctly. At least one line.
function wrappedLineCount(text: string, width: number) {
  if (width <= 0) {
    return 1;
  }
  let lines = 1;
  let col = 0;
  for (const word of text.split(" ")) {
    const w = Bun.stringWidth(word);
    if (col === 0) {
      col = w;
    } else if (col + 1 + w <= width) {
      col += 1 + w;
    } else {
      lines += 1;
      col = w;
    }
  }
  return lines;
}

export function HelpDialog() {
  const theme = useTheme();
  // Both views reduce to one row shape: a left cell (key combo or colored glyph) and a description.
  // The registry and the mark set are both fixed, so this recomputes only on a view toggle or a
  // Live theme flip.
  const groups = createMemo(() =>
    state.helpView() === "marks"
      ? legendGroups().map((group) => ({
          entries: group.entries.map((entry) => ({
            left: entry.glyph,
            leftColor: entry.color?.(theme.colors) ?? theme.colors.text.strong,
            right: entry.meaning,
          })),
          heading: group.heading,
        }))
      : keyHelpGroups().map((group) => ({
          entries: group.entries.map((entry) => ({
            left: entry.combo,
            leftColor: theme.colors.text.strong,
            right: entry.description,
          })),
          heading: group.heading,
        })),
  );
  // A glyph needs only a few cells; a combo column holds `Shift+F12` and wider rebinds.
  const leftWidth = createMemo(() =>
    Math.max(
      state.helpView() === "keys" ? COMBO_WIDTH : 3,
      ...groups().flatMap((group) => group.entries.map((entry) => Bun.stringWidth(entry.left) + 2)),
    ),
  );
  // Size the list by its rendered height (descriptions can wrap to two lines), so the overlay shows
  // Every row without scrolling whenever the terminal has the room; sizing by entry count alone
  // Clipped wrapped rows off the bottom.
  const listHeight = createMemo(() => {
    // Row interior after the border (2), scrollbar gutter (1), padding (2), and the left column,
    // Slightly conservative so the list never clips a row.
    const rightWidth = state.overlayWidth() - 5 - leftWidth();
    const rendered = groups().reduce(
      (sum, group, index) =>
        // Heading row (1) + a one-line spacer before every group but the first.
        sum +
        (index === 0 ? 1 : 2) +
        group.entries.reduce(
          (lines, entry) => lines + wrappedLineCount(entry.right, rightWidth),
          0,
        ),
      0,
    );
    return Math.min(rendered, Math.max(1, state.terminalHeight() - 7));
  });
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
      <box
        height={1}
        flexDirection="row"
        justifyContent="space-between"
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={theme.colors.surface.panel}
      >
        <box flexDirection="row">
          <text
            fg={state.helpView() === "keys" ? theme.colors.text.strong : theme.colors.text.faint}
          >
            keys
          </text>
          <text fg={theme.colors.text.faint}>{" · "}</text>
          <text
            fg={state.helpView() === "marks" ? theme.colors.text.strong : theme.colors.text.faint}
          >
            marks
          </text>
        </box>
        <text fg={theme.colors.text.faint}>stet@{packageJson.version}</text>
      </box>
      <scrollbox
        width="100%"
        height={listHeight()}
        scrollY
        viewportCulling
        scrollbarOptions={{
          trackOptions: {
            backgroundColor: theme.rgba.transparent,
            foregroundColor: theme.colors.scrollbar.thumb,
          },
        }}
      >
        <For each={groups()}>
          {(group, index) => (
            <box width="100%" flexDirection="column">
              <Show when={index() > 0}>
                <box height={1} backgroundColor={theme.colors.surface.panel} />
              </Show>
              <box height={1} paddingLeft={1} backgroundColor={theme.colors.surface.panel}>
                <text fg={theme.colors.text.muted}>{group.heading}</text>
              </box>
              <For each={group.entries}>
                {(entry) => (
                  <box
                    width="100%"
                    flexDirection="row"
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={theme.colors.surface.panel}
                  >
                    <box width={leftWidth()} flexShrink={0}>
                      <text fg={entry.leftColor}>{entry.left}</text>
                    </box>
                    <box flexGrow={1}>
                      <text fg={theme.colors.text.secondary}>{entry.right}</text>
                    </box>
                  </box>
                )}
              </For>
            </box>
          )}
        </For>
      </scrollbox>
      <box height={1} paddingLeft={1} backgroundColor={theme.colors.surface.panel}>
        <text fg={theme.colors.text.muted}>esc close · tab switch</text>
      </box>
    </box>
  );
}
