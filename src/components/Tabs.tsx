import { batch, createMemo, Index, Show } from "solid-js";

import type { ChangeKind } from "../git/model";
import { state } from "../state";
import { useTheme } from "../theme/context";
import { truncateLeft, truncateName } from "../utils/text";

// The active tab shows its path (truncated from the left to keep the filename);
// Inactive tabs show just the basename. RIGHT_RESERVE keeps room for the status
// Segment (scope · stats · ln N) so the strip never shoves it off the row.
const PATH_MAX = 40;
const TAB_MAX = 24;
const RIGHT_RESERVE = 18;

function baseName(path: string) {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

// The inline tab strip: it replaces the viewer title when more than one tab is
// Open, reusing the existing title row (zero extra rows). The visible tabs are a
// Window centered on the active one, with ‹ › when more are clipped, so the
// Active tab is always shown however narrow the viewer.
export function Tabs() {
  const theme = useTheme();

  // Active = selected (on the cursor bg); preview = faint (ephemeral); otherwise a
  // Changed file's label is tinted by its kind, like the tree, leaving unchanged
  // Files muted.
  const labelColor = (cell: { active: boolean; preview: boolean; kind: ChangeKind | undefined }) =>
    cell.active
      ? theme.colors.text.selected
      : cell.preview
        ? theme.colors.text.faint
        : cell.kind !== undefined
          ? theme.colors.kind[cell.kind]
          : theme.colors.text.muted;

  const layout = createMemo(() => {
    const changed = state.gitModel().changedByPath;
    const cells = state.tabItems().map((tab) => {
      const label =
        tab.path === undefined
          ? "·"
          : tab.active
            ? truncateLeft(tab.path, PATH_MAX)
            : truncateName(baseName(tab.path), TAB_MAX);
      // The file's change-kind, used to color the label (changed files only).
      const kind = tab.path === undefined ? undefined : changed.get(tab.path)?.kind;
      return {
        active: tab.active,
        id: tab.id,
        kind,
        label,
        preview: tab.preview,
        // Display columns (a label can hold a wide glyph), plus the 1-col pad
        // Each side; the overflow window budgets against this.
        width: Bun.stringWidth(label) + 2,
      };
    });
    if (cells.length === 0) {
      return { cells, moreLeft: false, moreRight: false };
    }
    const active = Math.max(
      0,
      cells.findIndex((cell) => cell.active),
    );
    const budget = Math.max(8, state.terminalWidth() - state.sidebarWidth() - 4 - RIGHT_RESERVE);
    let start = active;
    let end = active;
    let used = cells[active].width;
    for (;;) {
      const canRight = end < cells.length - 1 && used + cells[end + 1].width <= budget;
      const canLeft = start > 0 && used + cells[start - 1].width <= budget;
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
            ref={(el) => (el.selectable = false)}
            backgroundColor={cell().active ? theme.colors.surface.cursor : undefined}
            onMouseDown={() => batch(() => state.activateTab(cell().id))}
          >
            <text ref={(el) => (el.selectable = false)} fg={labelColor(cell())}>
              {` ${cell().label} `}
            </text>
          </box>
        )}
      </Index>
      <Show when={layout().moreRight}>
        <text fg={theme.colors.text.faint}>{"›"}</text>
      </Show>
    </box>
  );
}
