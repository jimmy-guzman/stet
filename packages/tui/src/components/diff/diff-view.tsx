import { bg, fg, StyledText } from "@opentui/core";
import type {
  BoxRenderable,
  MouseEvent,
  RGBA,
  ScrollBoxRenderable,
  TextRenderable,
} from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import {
  batch,
  createEffect,
  createMemo,
  Index,
  onCleanup,
  Show,
  untrack,
} from "solid-js";

import { cellWidth, widthMethod } from "@/diff/cells";
import { followScrollTop, followScrollX, HORIZONTAL_STEP } from "@/diff/follow";
import { isLineRow } from "@/diff/rows";
import type { DiffLineRow, DiffRow } from "@/diff/rows";
import { columnToIndex, markRange, sliceSpansWindow } from "@/diff/spans";
import type { HighlightSpan } from "@/diff/spans";
import {
  cumulativeRowEnds,
  rowIndexAtOffset,
  visibleWindow,
  visibleWindowVariable,
} from "@/diff/windowing";
import { state } from "@/state";
import { activeThemeMonochrome } from "@/theme/active";
import { theme } from "@/theme/context";
import { selectedColumns } from "@/viewer/selection";
import type { SelectionPoint, SelectionUnit } from "@/viewer/selection";

import { CommandMenu } from "../command-menu";
import { isRightClick } from "../mouse";
import { createLineMeasurer } from "./line-measure";

/** Display columns, [from, to). */
interface CellRange {
  from: number;
  to: number;
}

// Only removed/added lines carry changed words, so a context row never reads this.
const changedWordBg = (row: DiffLineRow, lifted: boolean) => {
  if (row.type === "add") {
    return lifted ? theme.rgba.addedWordBgActive : theme.rgba.addedWordBg;
  }

  return lifted ? theme.rgba.removedWordBgActive : theme.rgba.removedWordBg;
};

// One renderable per line: the per-token colors live inside a single StyledText
// Buffer instead of one <text> per token (a screenful of highlighted code was
// Hundreds of flex nodes). Content is set imperatively because the binding's
// `content` prop stringifies objects and StyledText is not a typed JSX child.
const StyledLine = (props: {
  row: DiffLineRow;
  wrap: boolean;
  width: number;
  scrollX: number;
  selected: CellRange | undefined;
  /** The row wears the lifted cursor/selection background, so its changed words layer over that. */
  lifted: boolean;
}) => {
  let ref: TextRenderable | undefined;
  createEffect(() => {
    if (ref === undefined) {
      return;
    }

    const { row } = props;

    // The change bar and line metadata live in the fixed gutter (so they stay put while
    // The code scrolls); this buffer renders code only.
    const windowed = props.wrap
      ? row.spans
      : sliceSpansWindow(row.spans, props.scrollX, props.width);

    // The selected range is in content display columns; in scroll mode the window starts at
    // ScrollX, so shift it. In wrap mode the styling follows the text wherever it wraps.
    const offset = props.wrap ? 0 : props.scrollX;

    const spans: HighlightSpan[] =
      props.selected === undefined
        ? windowed
        : markRange(
            windowed,
            props.selected.from - offset,
            props.selected.to - offset
          );

    // A changed word layers its line's sign color over the row's own background. A row with
    // Selected text drops its marks: in a theme with no hue they are the selection's own grey, so
    // Its end could not be seen.
    const wordBg = changedWordBg(row, props.lifted);

    ref.content = new StyledText(
      spans.map((part) => {
        const chunk = fg(part.fg ?? theme.colors.text.primary)(part.text);

        if (part.highlight === true) {
          return bg(theme.colors.selection.bg)(chunk);
        }

        return part.changed === true && props.selected === undefined
          ? bg(wordBg)(chunk)
          : chunk;
      })
    );
  });

  return (
    <text
      ref={(el) => {
        ref = el;
        // Opt this text leaf out of OpenTUI's native text selection (which a drag
        // Would otherwise start on the deepest hit, painting its own colorful
        // Highlight over our band); stet owns the selection.
        el.selectable = false;
      }}
      // Pinned to the width `heights()` measured against: left to flex layout, the leaf sizes one
      // Cell wider than its box, so it wrapped at a width the measurer never saw and the
      // Overflowing column was clipped off the right edge.
      width={props.width}
      wrapMode={props.wrap ? "word" : "none"}
    />
  );
};

const wrap = () => state.overflow() === "wrap";

const clickUnit = (count: number): SelectionUnit => {
  if (count === 3) {
    return "line";
  }

  return count === 2 ? "word" : "character";
};

// Which way a drag at this row scrolls: only past the viewport, since a drag along its first or last
// Row is selecting that row. The title above and the bar below always leave room to go past.
const edgeDirection = (localY: number) => {
  if (localY < 0) {
    return -1;
  }

  return localY >= state.viewerHeight() ? 1 : 0;
};

// Like the tree's cursor row, the caret line lifts only while the viewer holds focus: with no frame
// Around either pane, the lit cursor is the focus mark.
const isCursor = (row: DiffLineRow) =>
  state.focusedPane() === "diff" && row.navIndex === state.cursorIndex();

// A row inside a whole-line selection wears the cursor lift (`resolveBackground`'s active branch),
// So the band is theme-correct per diff state and covers blank lines. Any other selection paints
// Its own columns (`selectedCells`).
const isSelected = (row: DiffLineRow) => {
  const range = state.selectionRange();

  return (
    range !== undefined &&
    state.viewerSelection()?.unit === "line" &&
    row.navIndex >= range.start.index &&
    row.navIndex <= range.end.index
  );
};

const rowText = (row: DiffLineRow) =>
  row.spans.map((span) => span.text).join("");

/** The selected display columns of a row, for a selection that is not whole lines. */
const selectedCells = (row: DiffLineRow): CellRange | undefined => {
  const range = state.selectionRange();

  if (range === undefined || state.viewerSelection()?.unit === "line") {
    return undefined;
  }

  const content = rowText(row);
  const columns = selectedColumns(range, row.navIndex, content);

  return columns === undefined || columns.from === columns.to
    ? undefined
    : {
        from: cellWidth(content.slice(0, columns.from)),
        to: cellWidth(content.slice(0, columns.to)),
      };
};

/** Whether a point is on selected text, or on a selected line. */
const isOnSelection = ({ column, index }: SelectionPoint) => {
  const range = state.selectionRange();

  if (range === undefined) {
    return false;
  }

  if (state.viewerSelection()?.unit === "line") {
    return index >= range.start.index && index <= range.end.index;
  }

  const content = state.navigableLines()[index]?.content ?? "";
  const columns = selectedColumns(range, index, content);

  // A blank line has no glyph to be on, but a selection that spans it copies it.
  return (
    columns !== undefined &&
    (content === "" || (column >= columns.from && column < columns.to))
  );
};

// A lifted row is too close to the selection's own background to show where it ends, so a row with
// Selected text drops the lift from its code. Its gutter keeps it, so the caret line stays marked.
const isCodeLifted = (row: DiffLineRow) =>
  isSelected(row) || (isCursor(row) && selectedCells(row) === undefined);

// The gutter reads left to right as change bar, number, then code: the far-left change bar
// And the number digits take the diff state (add green / remove red / context neutral).
// The bar is a single ¼-block glyph, add vs remove told apart by color alone (a deliberate
// Call: equal footprint over a NO_COLOR distinction, which the +/- column used to carry),
// Except under a monochrome theme, where color cannot carry it and the same cell renders
// `+`/`-` instead. It is a Block Element (reliably one cell wide), never Box-Drawing, whose
// Rarer glyphs fall back to a mis-metriced font and misalign the gutter.
const gutterNumberColor = (row: DiffLineRow) => {
  if (row.type === "add") {
    return theme.colors.diff.addedSign;
  }

  return row.type === "remove"
    ? theme.colors.diff.removedSign
    : theme.colors.diff.lineNumberFg;
};

const changeBar = (row: DiffLineRow) => {
  if (row.type === "context") {
    return " ";
  }

  if (activeThemeMonochrome()) {
    return row.type === "add" ? "+" : "-";
  }

  return "▎";
};

const changeBarColor = (row: DiffLineRow) => {
  if (row.type === "add") {
    return theme.colors.diff.addedSign;
  }

  return row.type === "remove"
    ? theme.colors.diff.removedSign
    : theme.colors.text.faint;
};

const resolveBackground = (
  background: { normal: string; active: RGBA } | undefined,
  cursor: boolean
) =>
  cursor
    ? (background?.active ?? theme.colors.surface.cursor)
    : background?.normal;

// The gutter shares the line's add/remove tint so a changed line reads as one band edge
// To edge. It follows diff state only, not the find match (a search hit stays a
// Content-only highlight; the changed-line band stays stable underneath it).
const gutterState = (row: DiffLineRow) => {
  if (row.type === "add") {
    return {
      active: theme.rgba.addedBgActive,
      normal: theme.colors.diff.addedBg,
    };
  }

  return row.type === "remove"
    ? {
        active: theme.rgba.removedBgActive,
        normal: theme.colors.diff.removedBg,
      }
    : undefined;
};

const gutterBackground = (row: DiffLineRow) =>
  resolveBackground(gutterState(row), isCursor(row) || isSelected(row));

const asLineRow = (row: DiffRow) => (isLineRow(row) ? row : undefined);

// A non-line row: a fold (`▸ N lines folded`), a collapsed git gap
// (`⋯ N unmodified lines`), an expanded gap's re-collapse handle (`⋯ hide N …`), or
// A separator that carries its own glyph (`\ No newline at end of file`).
const markerGlyph = (row: DiffRow) => {
  if (row.kind === "separator") {
    return row.glyph;
  }

  return row.kind === "marker" && row.regionKind === "fold" ? "▸" : "⋯";
};

const markerLabel = (row: DiffRow) => {
  if (row.kind === "separator") {
    return row.text;
  }

  if (row.kind !== "marker") {
    return "";
  }

  const noun = row.count === 1 ? "line" : "lines";

  if (row.regionKind === "fold") {
    return `${row.count} ${noun} folded`;
  }

  return row.collapsed
    ? `${row.count} unmodified ${noun}`
    : `hide ${row.count} unmodified ${noun}`;
};

const toggleMarker = (row: DiffRow) => {
  if (row.kind !== "marker") {
    return;
  }

  if (row.regionKind === "fold") {
    state.toggleFold(row.key);
  } else {
    state.toggleGap(row.key);
  }
};

// Stet-owned diff renderer: only the visible row slice is mounted (windowed),
// And the line-number gutter is padded to a file-wide fixed width so it never
// Oscillates. That stable width is the property that keeps OpenTUI's layout from
// Thrashing into the scheduler wedge the built-in `<diff>` triggered.
export const DiffView = () => {
  const renderer = useRenderer();

  // Remade when the terminal's width method changes, so wrapped rows and pointer columns are always
  // Measured the one way.
  const measurer = createMemo(() => {
    const current = createLineMeasurer(widthMethod(), renderer.nativeScene);

    onCleanup(() => {
      current.destroy();
    });

    return current;
  });

  let scrollRef: ScrollBoxRenderable | undefined;
  let interactionRef: BoxRenderable | undefined;
  // Scroll offsets live in `state` (lifted out of this component) so a navigation
  // Can capture and restore them; this view is just their reader/writer.
  const scrollTop = state.viewerScrollTop;
  const setScrollTop = state.setViewerScrollTop;
  const scrollX = state.viewerScrollX;
  const setScrollX = state.setViewerScrollX;

  // Search unmounts this view. On return, keep its viewport until the caret or layout moves.
  const followOnMount = untrack(state.pendingRestore) !== undefined;

  const rows = createMemo<DiffRow[]>(() => state.viewerRows());

  // Mouse capture belongs to one stable viewer-sized interaction layer, never a
  // Windowed row that can unmount while scrolling changes the visible slice.
  // The left press a drag extends from; undefined between gestures.
  let press: { anchor: SelectionPoint; unit: SelectionUnit } | undefined;
  // Whether this gesture selected anything, which its release copies.
  let selecting = false;
  let lastClick = { count: 0, time: 0, x: 0, y: 0 };
  let dragPointer = { x: 0, y: 0 };
  let dragScroll = { x: 0, y: 0 };
  let dragScrollTimer: ReturnType<typeof setInterval> | undefined;

  // Nearest line row's navIndex for every `rows()` index (the line at or before it,
  // Else the first line after), precomputed so a drag tick is an O(1) lookup instead
  // Of re-scanning rows() each time.
  const nearestNavByRow = createMemo(() => {
    const all = rows();
    let last = all.find(isLineRow)?.navIndex;

    return all.map((row) => {
      if (isLineRow(row)) {
        last = row.navIndex;
      }

      return last;
    });
  });

  const findMatchSet = createMemo(() => new Set(state.findMatches()));

  // Row indices of the navigable (line) rows, so a cursor navIndex maps to its
  // Position in the full row stream (which also contains hunk headers).
  const lineRowIndices = createMemo(() => {
    const indices: number[] = [];

    for (const [index, row] of rows().entries()) {
      if (row.kind === "line") {
        indices.push(index);
      }
    }

    return indices;
  });

  // File-wide max line-number digit count -> a gutter width that is constant for
  // The whole file, never resized from the visible slice.
  const numberWidth = createMemo(() => {
    let max = 1;

    for (const row of rows()) {
      if (isLineRow(row)) {
        max = Math.max(max, row.newLine ?? 0, row.oldLine ?? 0);
      }
    }

    return String(max).length;
  });

  // The gutter is a change bar then the number: fixed cells left of the code, so a context
  // Line reserves the bar column and never shifts (bar + number + space).
  const gutterWidth = () => numberWidth() + 2;

  const contentWidth = () =>
    Math.max(1, state.layout().viewer.content.width - gutterWidth());

  // Per-row terminal heights for windowing spacers and cursor-follow. In non-wrap
  // Mode every row is exactly one terminal row (`wrapMode="none"`), so heights are
  // Uniform; in wrap mode each line row is measured exactly against OpenTUI's own
  // Word-wrap engine so the cumulative offsets match the rendered layout.
  const heights = createMemo(() => {
    if (!wrap()) {
      return rows().map(() => 1);
    }

    const width = contentWidth();

    return rows().map((row) => {
      if (row.kind !== "line") {
        return 1;
      }

      // The gutter (bar/number/glyph) is fixed, so the content that wraps is code only.
      return measurer().measure(rowText(row), width);
    });
  });

  const rowEnds = createMemo(() => cumulativeRowEnds(heights()));
  const contentHeight = () => rowEnds().at(-1) ?? 0;

  // Widest line in the file (display columns), so horizontal scroll has a stable
  // Range that doesn't shift as you scroll vertically.
  const longestLine = createMemo(() => {
    let max = 0;

    for (const row of rows()) {
      if (isLineRow(row)) {
        max = Math.max(max, cellWidth(rowText(row)));
      }
    }

    return max;
  });

  // Which way a drag at this column scrolls: out over the gutter, or against the last column, since
  // The viewer reaches the terminal's right edge and a pointer cannot go past it.
  const horizontalEdge = (localX: number) => {
    if (localX < gutterWidth()) {
      return -1;
    }

    return localX >= gutterWidth() + contentWidth() - 1 ? 1 : 0;
  };

  const maxScrollX = () => Math.max(0, longestLine() - contentWidth());

  // The deepest the viewport can scroll: total content height (sum of per-row
  // Heights — `rows().length` in non-wrap, the wrapped total otherwise) minus the
  // Viewport. Bounds the wheel-driven scrollTop so it never runs past the content.
  const maxScrollY = () => Math.max(0, contentHeight() - state.viewerHeight());

  // Context rows kept between the cursor and the top/bottom edge as it moves.
  const CURSOR_SCROLL_MARGIN = 3;

  // Mount a few rows beyond the viewport as a buffer so a fast scroll tick never
  // Flashes an unmounted row at the viewport edge.
  const OVERSCAN = 8;

  const window = createMemo(() =>
    wrap()
      ? visibleWindowVariable(
          heights(),
          scrollTop(),
          state.viewerHeight(),
          OVERSCAN
        )
      : visibleWindow(
          rows().length,
          scrollTop(),
          state.viewerHeight(),
          OVERSCAN
        )
  );

  const visibleRows = createMemo(() =>
    rows().slice(window().start, window().end)
  );

  // Clamp horizontal scroll when the range shrinks (terminal resize / shorter
  // File). The reset-on-file-change is now owned by the viewer's pendingRestore.
  createEffect(() => {
    const max = maxScrollX();

    if (scrollX() > max) {
      setScrollX(max);
    }
  });
  // Clamp scrollTop when the content shrinks under it (toggle to a shorter file,
  // Terminal resize), mirroring the scrollX clamp. Reads scrollTop untracked so it
  // Fires on a height/viewport change, not on every scroll tick, and never feeds
  // Back into the projection below.
  createEffect(() => {
    const max = maxScrollY();

    if (untrack(scrollTop) > max) {
      setScrollTop(max);
    }
  });

  /**
   * The scrollbox's physical scroll is a pure projection of the scrollTop signal: the windowed slice
   * (driven by scrollTop) and what's painted must never disagree. A scroll made in the same tick as a
   * content swap could land against the old height and strand the viewport in the empty top spacer
   * (the toggle-blank bug), but OpenTUI's `scrollTo` applies again after the next frame's layout, so
   * it lands against the new content. Only the target needs tracking: content that shrinks under
   * scrollTop moves it through the clamp above, and the scrollbox keeps its own position when its
   * content grows.
   */
  createEffect(() => {
    scrollRef?.scrollTo(scrollTop());
  });

  // Wheel: left/right scroll long lines horizontally (shared across all lines, so
  // The whole view shifts); up/down drive scrollTop directly (the projection above
  // Carries it to the scrollbox). Both axes own the scroll and zero the native
  // Delta so the scrollbox never also acts on it: scrollTop must stay the single
  // Source of truth for the window, or a native read-back races the uncommitted
  // Scroll and the slice trails the visible content, blanking the lower viewport.
  const VERTICAL_STEP = 3;

  const onWheel = (event: MouseEvent) => {
    const direction = event.scroll?.direction;
    const delta = event.scroll?.delta ?? 1;

    if (direction === "left" || direction === "right") {
      if (!wrap()) {
        const sign = direction === "right" ? 1 : -1;
        setScrollX((previous) =>
          Math.max(
            0,
            Math.min(previous + sign * delta * HORIZONTAL_STEP, maxScrollX())
          )
        );
      }

      if (event.scroll !== undefined) {
        event.scroll.delta = 0;
      }

      return;
    }

    const sign = direction === "down" ? 1 : -1;
    setScrollTop((previous) =>
      Math.max(
        0,
        Math.min(previous + sign * delta * VERTICAL_STEP, maxScrollY())
      )
    );

    if (event.scroll !== undefined) {
      event.scroll.delta = 0;
    }
  };

  const localPointer = (event: MouseEvent) => ({
    x: event.x - (interactionRef?.screenX ?? 0),
    y: event.y - (interactionRef?.screenY ?? 0),
  });

  const rowIndexForPointer = (
    localY: number,
    currentScroll = untrack(scrollTop)
  ) => rowIndexAtOffset(rowEnds(), currentScroll + localY);

  // The glyph under a pointer, clamped into the visible content: past either end of a line is that
  // Line's end, below the file is its last line's end, and a marker row is the line on the drag's own
  // Side.
  const pointAt = (
    pointer: { x: number; y: number },
    currentScroll = untrack(scrollTop)
  ): SelectionPoint | undefined => {
    const y = Math.max(0, Math.min(pointer.y, state.viewerHeight() - 1));
    const rowIndex = rowIndexForPointer(y, currentScroll);
    const row = rows()[rowIndex ?? rows().length - 1];

    if (row === undefined) {
      return undefined;
    }

    if (rowIndex === undefined || !isLineRow(row)) {
      const index = nearestNavByRow()[rowIndex ?? rows().length - 1];

      if (index === undefined) {
        return undefined;
      }

      const before = (lineRowIndices()[index] ?? 0) <= (rowIndex ?? Infinity);

      // A drag up from below the marker stops short of the lines it hides.
      if (before && press !== undefined && press.anchor.index > index) {
        return { column: 0, index: index + 1 };
      }

      return {
        column: before
          ? (state.navigableLines()[index]?.content.length ?? 0)
          : 0,
        index,
      };
    }

    const content = rowText(row);

    const x = Math.max(
      0,
      Math.min(pointer.x - gutterWidth(), contentWidth() - 1)
    );

    if (!wrap()) {
      return {
        column: columnToIndex(content, x + untrack(scrollX)),
        index: row.navIndex,
      };
    }

    const visualRow = currentScroll + y - (rowEnds()[rowIndex - 1] ?? 0);

    const start = measurer().offsetForVisualRow(
      content,
      contentWidth(),
      visualRow
    );

    const next = measurer().offsetForVisualRow(
      content,
      contentWidth(),
      visualRow + 1
    );

    // Past the end of a wrapped row is that row's last glyph, not one from the row below.
    return {
      column: columnToIndex(
        content,
        next > start ? Math.min(start + x, next - 1) : start + x
      ),
      index: row.navIndex,
    };
  };

  // How many times in a row this spot was clicked, up to a triple-click, by OpenTUI's own rule (its
  // Mouse events carry no count).
  const clickCount = (event: MouseEvent) => {
    const now = performance.now();

    const repeated =
      now - lastClick.time <= 500 &&
      Math.abs(event.x - lastClick.x) <= 1 &&
      Math.abs(event.y - lastClick.y) <= 1;

    const count = repeated ? Math.min(lastClick.count + 1, 3) : 1;
    lastClick = { count, time: now, x: event.x, y: event.y };

    return count;
  };

  const selectTo = (focus: SelectionPoint) => {
    if (press === undefined) {
      return;
    }

    selecting = true;
    const { anchor, unit } = press;
    state.select({ anchor, focus, unit });
  };

  // A drag selects once it leaves the glyph (or, from the gutter, the line) it started on, so a
  // Click that wobbles selects nothing.
  const extendDrag = () => {
    const focus = pointAt(dragPointer);

    if (focus === undefined || press === undefined) {
      return;
    }

    const moved =
      focus.index !== press.anchor.index ||
      (press.unit !== "line" && focus.column !== press.anchor.column);

    if (selecting || moved) {
      selectTo(focus);
    }
  };

  const stopDragScroll = () => {
    dragScroll = { x: 0, y: 0 };

    if (dragScrollTimer !== undefined) {
      clearInterval(dragScrollTimer);
      dragScrollTimer = undefined;
    }
  };

  const endDrag = () => {
    press = undefined;
    selecting = false;
    stopDragScroll();
  };

  // The release copies, once: OpenTUI reports both a drag's end and the button going up.
  const finishDrag = () => {
    const copies = selecting;
    endDrag();

    if (copies) {
      state.copySelection();
    }
  };

  // One press, in the caller's batch, so it lands as one update. Returns whether it asks for the
  // Context menu, which opens after the batch: moving the cursor can scroll, and the menu closes
  // On a scroll it did not open at.
  const pressAt = (event: MouseEvent) => {
    // A press that leaves the cursor where it is drifts nothing the menu's guard watches.
    state.closeCommandMenu();
    state.setFocusedPane("diff");

    const pointer = localPointer(event);
    const rowIndex = rowIndexForPointer(pointer.y);
    const row = rowIndex === undefined ? undefined : rows()[rowIndex];
    const point = pointAt(pointer);

    if (row === undefined || point === undefined) {
      if (event.button === 0) {
        state.clearSelection();
      }

      return false;
    }

    if (!isLineRow(row)) {
      toggleMarker(row);

      return false;
    }

    if (isRightClick(event)) {
      // The menu acts on a selection it opens over, so the press keeps it.
      if (!isOnSelection(point)) {
        state.setCursorRow(point.index);
      }

      return true;
    }

    if (event.button !== 0) {
      return false;
    }

    if (event.modifiers.shift) {
      const current = state.viewerSelection();

      press = {
        anchor: current?.anchor ?? { column: 0, index: state.cursorIndex() },
        unit: current?.unit ?? "line",
      };
      selectTo(point);

      return false;
    }

    const count = clickCount(event);

    press = {
      anchor: point,
      unit: pointer.x < gutterWidth() ? "line" : clickUnit(count),
    };
    state.setCursorRow(point.index);

    if (count > 1) {
      selectTo(point);
    }

    return false;
  };

  const scrollDragSelection = () => {
    const top = untrack(scrollTop);
    const left = untrack(scrollX);

    const nextTop = Math.max(0, Math.min(top + dragScroll.y, maxScrollY()));

    const nextLeft = Math.max(
      0,
      Math.min(left + dragScroll.x * HORIZONTAL_STEP, maxScrollX())
    );

    if (nextTop === top && nextLeft === left) {
      stopDragScroll();

      return;
    }

    batch(() => {
      setScrollTop(nextTop);
      setScrollX(nextLeft);
    });
    extendDrag();
  };

  const updateDragScroll = () => {
    const direction = {
      x: wrap() || press?.unit === "line" ? 0 : horizontalEdge(dragPointer.x),
      y: edgeDirection(dragPointer.y),
    };

    if (direction.x === 0 && direction.y === 0) {
      stopDragScroll();

      return;
    }

    if (
      direction.x === dragScroll.x &&
      direction.y === dragScroll.y &&
      dragScrollTimer !== undefined
    ) {
      return;
    }

    stopDragScroll();
    dragScroll = direction;
    dragScrollTimer = setInterval(scrollDragSelection, 50);
  };

  onCleanup(endDrag);

  // Keep the cursor's row inside the viewport by scrolling the box to it, with a
  // Margin of context rows so the cursor never glues to the very edge (where a
  // Frame of scheduling lag could push it off screen). Reads the current scroll
  // Offset untracked: this effect must fire only when the cursor or layout moves,
  // Never when scrollTop itself changes. Tracking scrollTop would make it re-run
  // On every wheel tick and snap the off-screen cursor back into view, so free
  // Wheel scrolling could never leave the cursor's screen.
  createEffect((follow: boolean) => {
    const cursorRow = lineRowIndices()[state.cursorIndex()];

    if (press !== undefined) {
      return true;
    }

    if (cursorRow === undefined || scrollRef === undefined) {
      return true;
    }

    const rowHeights = heights();
    const top = rowEnds()[cursorRow - 1] ?? 0;
    const current = untrack(scrollTop);

    const next = followScrollTop({
      current,
      height: rowHeights[cursorRow] ?? 1,
      margin: CURSOR_SCROLL_MARGIN,
      maxScroll: maxScrollY(),
      top,
      viewport: state.viewerHeight(),
    });

    if (follow && next !== current) {
      setScrollTop(next);
    }

    return true;
  }, followOnMount);

  // The cursor row's cumulative top, the same sum the vertical-follow effect uses,
  // Lifted to a memo so the context menu's anchor reads it without recomputing.
  const cursorTop = createMemo(() => {
    const cursorRow = lineRowIndices()[state.cursorIndex()];

    return cursorRow === undefined
      ? undefined
      : (rowEnds()[cursorRow - 1] ?? 0);
  });

  // The viewer interior width (gutter + content), the coordinate
  // Space the context menu's absolute left/clamp live in.
  const innerWidth = () => contentWidth() + gutterWidth();

  // The cell the context menu opens at, in viewer-content coordinates: the one right-clicked, else
  // The start of the caret line. Undefined when that line is scrolled out of view, which hides the
  // Menu.
  const commandAnchor = createMemo(() => {
    const at = state.commandMenuAnchor();

    if (at !== undefined) {
      return { col: at.x, row: at.y };
    }

    const top = cursorTop();
    const row = top === undefined ? -1 : top - state.viewerScrollTop();

    return row < 0 || row >= state.viewerHeight()
      ? undefined
      : { col: gutterWidth(), row };
  });

  // A viewer menu with no on-screen anchor (the caret is scrolled out of view) would
  // Render nothing yet still gate the keyboard, so Shift+F10 on an off-screen caret
  // Would trap it. Close it instead, so opening an unanchorable menu is a no-op.
  createEffect(() => {
    if (
      state.commandMenuOpen() &&
      state.commandMenuContext() === "viewer" &&
      commandAnchor() === undefined
    ) {
      state.closeCommandMenu();
    }
  });

  // Scroll a requested range into view (scroll mode only; wrap mode has no horizontal scroll). The
  // Request is consumed here, so it never fights a later sideways scroll.
  const REVEAL_MARGIN = 4;
  createEffect(() => {
    const range = state.revealRange();

    if (range === undefined) {
      return;
    }

    state.setRevealRange(undefined);

    if (!wrap()) {
      setScrollX((current) =>
        followScrollX({
          current,
          from: range.from,
          margin: REVEAL_MARGIN,
          maxScroll: maxScrollX(),
          to: range.to,
          viewport: contentWidth(),
        })
      );
    }
  });

  // Each line's background: a find match wins, else a faint add/remove tint (the change
  // Bar and colored number carry the diff state; this is just a subtle block cue). The
  // Cursor lift brightens whatever state the line has rather than replacing it, so a
  // Selected tinted line stays its own color; a context line falls back to the neutral
  // Cursor highlight (or nothing when it isn't the cursor).
  const contentState = (row: DiffLineRow) => {
    if (findMatchSet().has(row.navIndex)) {
      return {
        active: theme.rgba.findMatchBgActive,
        normal: theme.colors.find.matchBg,
      };
    }

    if (row.type === "add") {
      return {
        active: theme.rgba.addedBgActive,
        normal: theme.colors.diff.addedBg,
      };
    }

    return row.type === "remove"
      ? {
          active: theme.rgba.removedBgActive,
          normal: theme.colors.diff.removedBg,
        }
      : undefined;
  };

  const contentBackground = (row: DiffLineRow) =>
    resolveBackground(contentState(row), isCodeLifted(row));

  const lineLabel = (row: DiffLineRow) =>
    String(row.newLine ?? row.oldLine ?? "").padStart(numberWidth());

  return (
    <box position="relative" width="100%" height={state.viewerHeight()}>
      <scrollbox
        ref={(el) => {
          scrollRef = el;
        }}
        width="100%"
        height={state.viewerHeight()}
        scrollY
        scrollbarOptions={{
          trackOptions: {
            backgroundColor: theme.rgba.transparent,
            foregroundColor: theme.colors.scrollbar.thumb,
          },
          visible: false,
        }}
      >
        <box width="100%" height={window().topSpacer} />
        {/* Non-wrap rows are pinned to height 1 because `heights()` counts every such
          row as one terminal row, and the spacers/maxScrollY derive from that. Some
          graphemes (emoji with a U+FE0F variation selector) otherwise lay a
          `wrapMode="none"` text out two rows tall, under-counting the content height
          and stranding the file's last line below the fold. Separators count as 1 in
          both modes, so they pin unconditionally. */}
        <Index each={visibleRows()}>
          {(row, rowIndex) => (
            <Show
              when={asLineRow(row())}
              fallback={
                <box
                  width="100%"
                  height={1}
                  backgroundColor={theme.colors.surface.panel}
                >
                  <text
                    ref={(el) => {
                      el.selectable = false;
                    }}
                    fg={theme.colors.text.faint}
                  >
                    {`${markerGlyph(row())
                      .padStart(numberWidth() + 1)
                      .padEnd(gutterWidth())}${markerLabel(row())}`}
                  </text>
                </box>
              }
            >
              {(line) => (
                <box
                  width="100%"
                  flexDirection="row"
                  // Explicit per-row height in both modes, from the same `heights()`
                  // The spacers and scroll math use. A `1 -> undefined` (fixed -> auto)
                  // Transition does not relayout the text leaf, so a `z` toggle into
                  // Wrap left long lines stuck at one row; `1 -> N` always relayouts.
                  height={heights()[window().start + rowIndex] ?? 1}
                >
                  <text
                    ref={(el) => {
                      el.selectable = false;
                    }}
                    fg={changeBarColor(line())}
                    bg={gutterBackground(line())}
                  >
                    {changeBar(line())}
                  </text>
                  <text
                    ref={(el) => {
                      el.selectable = false;
                    }}
                    fg={gutterNumberColor(line())}
                    bg={gutterBackground(line())}
                  >
                    {`${lineLabel(line())} `}
                  </text>
                  <box flexGrow={1} backgroundColor={contentBackground(line())}>
                    <StyledLine
                      row={line()}
                      wrap={wrap()}
                      width={contentWidth()}
                      scrollX={scrollX()}
                      selected={selectedCells(line())}
                      lifted={isCodeLifted(line())}
                    />
                  </box>
                </box>
              )}
            </Show>
          )}
        </Index>
        <box width="100%" height={window().bottomSpacer} />
      </scrollbox>
      <box
        ref={(el) => {
          interactionRef = el;
          el.selectable = false;
          el.focusable = false;
        }}
        position="absolute"
        left={0}
        top={0}
        width="100%"
        height={state.viewerHeight()}
        backgroundColor={theme.rgba.transparent}
        zIndex={1}
        onMouseScroll={onWheel}
        onMouseDown={(event: MouseEvent) => {
          event.stopPropagation();

          if (batch(() => pressAt(event))) {
            state.openCommandMenu("viewer", localPointer(event));
          }
        }}
        onMouseDrag={(event: MouseEvent) => {
          event.stopPropagation();

          if (press === undefined) {
            return;
          }

          dragPointer = localPointer(event);
          extendDrag();
          updateDragScroll();
        }}
        onMouseDragEnd={finishDrag}
        onMouseUp={finishDrag}
      />
      <Show
        when={
          state.commandMenuOpen() && state.commandMenuContext() === "viewer"
        }
      >
        <CommandMenu
          anchor={commandAnchor}
          viewportWidth={innerWidth}
          viewportHeight={state.viewerHeight}
        />
      </Show>
    </box>
  );
};
