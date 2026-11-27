import { createMemo, For, Show } from "solid-js";

import { keyHelpGroups } from "@/help/keys";
import { legendGroups } from "@/help/legend";
import { state } from "@/state";
import { theme } from "@/theme/context";

import packageJson from "../../package.json";
import { ActionText } from "./action-text";
import { useLineMeasurer } from "./diff/line-measure";
import { scrollboxBar } from "./scrollbar";

// Minimum width of the left column box (the key combo or, on the marks view, the glyph); the
// Description wraps in whatever remains of the row. A reserved-width box (not string padding) keeps
// The right column aligned even on rows whose description wraps to a second line. It widens to the
// Longest rendered left cell (a rebind can exceed `Shift+F10`), or that cell wraps and the height
// Calc (which counts only description wraps) undercounts and clips a row.
const COMBO_WIDTH = 11;

const tabTone = (view: "keys" | "marks") =>
  state.helpView() === view
    ? theme.colors.text.strong
    : theme.colors.text.faint;

export const HelpDialog = () => {
  const measurer = useLineMeasurer();
  const bar = scrollboxBar();

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
        }))
  );

  // A glyph needs only a few cells; a combo column holds `Shift+F10` and wider rebinds.
  const leftWidth = createMemo(() =>
    Math.max(
      state.helpView() === "keys" ? COMBO_WIDTH : 3,
      ...groups().flatMap((group) =>
        group.entries.map((entry) => Bun.stringWidth(entry.left) + 2)
      )
    )
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
          (lines, entry) => lines + measurer().measure(entry.right, rightWidth),
          0
        ),
      0
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
          {/* The active view is bracketed as well as brightened, so it reads under NO_COLOR. */}
          <ActionText
            label={state.helpView() === "keys" ? "[keys]" : "keys"}
            fg={tabTone("keys")}
            onPress={() => {
              state.setHelpView("keys");
            }}
          />
          <text selectable={false} fg={theme.colors.text.faint}>
            {" · "}
          </text>
          <ActionText
            label={state.helpView() === "marks" ? "[marks]" : "marks"}
            fg={tabTone("marks")}
            onPress={() => {
              state.setHelpView("marks");
            }}
          />
        </box>
        <text fg={theme.colors.text.faint}>stet@{packageJson.version}</text>
      </box>
      <scrollbox
        ref={bar.ref}
        width="100%"
        height={listHeight()}
        scrollbarOptions={bar.options()}
        onMouseDown={bar.onMouseDown}
        onMouseUp={bar.onMouseUp}
      >
        <For each={groups()}>
          {(group, index) => (
            <box width="100%" flexDirection="column">
              <Show when={index() > 0}>
                <box height={1} backgroundColor={theme.colors.surface.panel} />
              </Show>
              <box
                height={1}
                paddingLeft={1}
                backgroundColor={theme.colors.surface.panel}
              >
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
                      {/* The space separates the two columns in copied text; the box has room for it. */}
                      <text fg={entry.leftColor}>{`${entry.left} `}</text>
                    </box>
                    <box flexGrow={1}>
                      <text fg={theme.colors.text.secondary}>
                        {entry.right}
                      </text>
                    </box>
                  </box>
                )}
              </For>
            </box>
          )}
        </For>
      </scrollbox>
      <box
        height={1}
        paddingLeft={1}
        backgroundColor={theme.colors.surface.panel}
      >
        <text fg={theme.colors.text.muted}>esc close · tab switch</text>
      </box>
    </box>
  );
};
