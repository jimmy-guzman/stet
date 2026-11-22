import { createTextAttributes } from "@opentui/core";
import { batch, createMemo, Index, Show } from "solid-js";

import { state } from "@/state";
import { theme } from "@/theme/context";
import { createDoubleClickGuard } from "@/utils/double-click";
import { truncateLeft, truncateName } from "@/utils/text";

// An inactive tab's basename cap; the active tab's path takes the strip's budget instead.
const TAB_MAX = 24;

// Each label's pad on either side; the rendered cell, its measured width, and
// The active label's budget all read it, so they cannot drift apart.
const LABEL_PAD = " ";

const baseName = (path: string) => {
  const slash = path.lastIndexOf("/");

  return slash === -1 ? path : path.slice(slash + 1);
};

/**
 * The viewer title's tone, which is the viewer's focus mark when it has no caret line: full strength
 * while the viewer holds focus, a step down otherwise. The lone-path title and the active tab share it.
 */
export const titleColor = () =>
  state.focusedPane() === "diff"
    ? theme.colors.text.primary
    : theme.colors.text.secondary;

const activeColor = (active: boolean) =>
  active ? titleColor() : theme.colors.text.muted;

const tabLabel = (path: string | undefined, active: boolean, room: number) => {
  if (path === undefined) {
    return "·";
  }

  // No fixed cap on the active path: SPEC has the active tab show its full path,
  // So a path as wide as the strip leaves the neighbours to their markers rather
  // Than cutting a path that would fit.
  return active
    ? truncateLeft(path, room)
    : truncateName(baseName(path), TAB_MAX);
};

/**
 * The inline tab strip: it replaces the viewer title when more than one tab is open, reusing the
 * existing title row (zero extra rows). The visible tabs are a window centered on the active one,
 * with ‹ › when more are clipped, so the active tab is always shown however narrow the viewer.
 *
 * @param props.budget The cells the strip may take, after the viewer's stats.
 */
export const Tabs = (props: { budget: number }) => {
  const isDoubleClick = createDoubleClickGuard();

  const layout = createMemo(() => {
    const items = state.tabItems();
    const { budget } = props;
    const last = items.length - 1;

    const active = Math.max(
      0,
      items.findIndex((tab) => tab.active)
    );

    // A clipped side shows a ‹ / › glyph (one column each), so a candidate window
    // Must fit its own width plus the markers it would still leave on; expanding to
    // An edge drops that side's marker and frees its column.
    const markers = (from: number, to: number) =>
      (from > 0 ? 1 : 0) + (to < last ? 1 : 0);

    // The markers a lone active tab would show come out of its own room too.
    const room = budget - markers(active, active);

    const cells = items.map((tab) => {
      // A strip too narrow for both pads and one label cell drops the pads, so
      // The active tab keeps its `…` the way the unpinned title does.
      const pad =
        tab.active && room < 2 * Bun.stringWidth(LABEL_PAD) + 1
          ? ""
          : LABEL_PAD;

      const label = tabLabel(
        tab.path,
        tab.active,
        room - 2 * Bun.stringWidth(pad)
      );

      return {
        active: tab.active,
        id: tab.id,
        label,
        pad,
        preview: tab.preview,
        // Display columns (a label can hold a wide glyph), plus the pad each
        // Side; the overflow window budgets against this.
        width: Bun.stringWidth(`${pad}${label}${pad}`),
      };
    });

    if (cells.length === 0) {
      return { cells, moreLeft: false, moreRight: false };
    }

    let start = active;
    let end = active;
    let used = cells[active].width;

    for (;;) {
      const canRight =
        end < last &&
        used + cells[end + 1].width + markers(start, end + 1) <= budget;

      const canLeft =
        start > 0 &&
        used + cells[start - 1].width + markers(start - 1, end) <= budget;

      if (!canRight && !canLeft) {
        break;
      }

      // Bias outward evenly, preferring the right so the active tab drifts left.
      if (canRight && (!canLeft || end - active <= active - start)) {
        end += 1;
        used += cells[end].width;
      } else {
        start -= 1;
        used += cells[start].width;
      }
    }

    return {
      cells: cells.slice(start, end + 1),
      moreLeft: start > 0,
      moreRight: end < cells.length - 1,
    };
  });

  return (
    <box flexDirection="row" flexShrink={1} overflow="hidden">
      <Show when={layout().moreLeft}>
        <text fg={theme.colors.text.faint}>{"‹"}</text>
      </Show>
      <Index each={layout().cells}>
        {(cell) => (
          <box
            // Non-selectable so a double-click on a tab label doesn't start an
            // OpenTUI text selection (a stray highlight); the strip is chrome,
            // Not content (mirrors Sidebar's focusable ref).
            ref={(el) => {
              el.selectable = false;
            }}
            onMouseDown={() => {
              batch(() => {
                state.activateTab(cell().id);

                if (isDoubleClick(cell().id)) {
                  state.pinActiveTab();
                }
              });
            }}
          >
            {/* Hierarchy by type, not chrome: the active tab is the one full-
                strength label, the rest recede to muted; the preview is italic. */}
            <text
              ref={(el) => {
                el.selectable = false;
              }}
              fg={activeColor(cell().active)}
              attributes={createTextAttributes({ italic: cell().preview })}
            >
              {`${cell().pad}${cell().label}${cell().pad}`}
            </text>
          </box>
        )}
      </Index>
      <Show when={layout().moreRight}>
        <text fg={theme.colors.text.faint}>{"›"}</text>
      </Show>
    </box>
  );
};
