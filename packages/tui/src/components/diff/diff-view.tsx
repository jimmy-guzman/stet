import { bg, fg, StyledText } from "@opentui/core";
import type {
  BoxRenderable,
  MouseEvent,
  RGBA,
  TextRenderable,
} from "@opentui/core";
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  Index,
  on,
  onCleanup,
  Show,
  untrack,
} from "solid-js";

import {
  isLeftClick,
  isRightClick,
  pressOnlyClosesMenu,
} from "@/components/mouse";
import { hoverable, retrackPointer } from "@/components/pointer";
import { cellWidth } from "@/diff/cells";
import { followScrollTop, followScrollX, HORIZONTAL_STEP } from "@/diff/follow";
import { isLineRow } from "@/diff/rows";
import type { DiffLineRow, DiffRow } from "@/diff/rows";
import { columnToIndex, markRange } from "@/diff/spans";
import type { HighlightSpan } from "@/diff/spans";
import {
  cumulativeRowEnds,
  rowIndexAtOffset,
  visibleWindow,
} from "@/diff/windowing";
import { state } from "@/state";
import { activeThemeMonochrome } from "@/theme/active";
import { theme } from "@/theme/context";
import { followLines, selectedColumns } from "@/viewer/selection";
import type { SelectionPoint, SelectionUnit } from "@/viewer/selection";

import { CommandMenu } from "../command-menu";
import { useLineMeasurer } from "./line-measure";

/** UTF-16 offsets into a line, [from, to). */
interface TextRange {
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
  /** The cells the text spans: what it wraps at, or the longest line it scrolls across. */
  width: number;
  scrollX: number;
  selected: TextRange | undefined;
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
    const spans: HighlightSpan[] =
      props.selected === undefined
        ? row.spans
        : markRange(row.spans, props.selected.from, props.selected.to);

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
      }}
      // Stet owns the viewer's selection, so OpenTUI's never includes a windowed row.
      selectable={false}
      // Every line shares one offset and one width. `scrollX` on the text would clamp to each
      // Line's own length and shift the short ones out of their columns.
      left={-props.scrollX}
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
// Its own columns (`selectedOffsets`).
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

/** The selected part of a row, for a selection that is not whole lines. */
const selectedOffsets = (row: DiffLineRow): TextRange | undefined => {
  const range = state.selectionRange();

  if (range === undefined || state.viewerSelection()?.unit === "line") {
    return undefined;
  }

  const columns = selectedColumns(range, row.navIndex, rowText(row));

  return columns?.from === columns?.to ? undefined : columns;
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
  isSelected(row) || (isCursor(row) && selectedOffsets(row) === undefined);

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
  const measurer = useLineMeasurer();

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

  // Per-row terminal heights for windowing and cursor-follow. In non-wrap
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

  const window = createMemo(() =>
    visibleWindow(rowEnds(), scrollTop(), state.viewerHeight())
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
  // Clamp scrollTop the same way: the content can shrink under it (toggle to a shorter file, terminal
  // Resize), and a restore can set a position remembered from a longer version of the file.
  createEffect(() => {
    const max = maxScrollY();

    if (scrollTop() > max) {
      setScrollTop(max);
    }
  });

  // Wheel: left/right scroll long lines horizontally (shared across all lines, so
  // The whole view shifts); up/down drive scrollTop.
  const VERTICAL_STEP = 3;

  const onWheel = (event: MouseEvent) => {
    const raw = event.scroll?.direction;

    // Shift turns a vertical wheel sideways, where the terminal forwards it as vertical. A sideways
    // Report stays as it came: macOS already turns shift+wheel horizontal and reports the shift too,
    // So swapping it back, as OpenTUI's own scrollers do, would scroll the wrong axis there. Wrapped
    // Lines have no sideways, so there the wheel keeps scrolling down the file.
    const direction =
      event.modifiers.shift && !wrap() && (raw === "up" || raw === "down")
        ? { down: "right", up: "left" }[raw]
        : raw;

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

      return;
    }

    const sign = direction === "down" ? 1 : -1;
    setScrollTop((previous) =>
      Math.max(
        0,
        Math.min(previous + sign * delta * VERTICAL_STEP, maxScrollY())
      )
    );
  };

  const localPointer = (event: MouseEvent) => ({
    x: event.x - (interactionRef?.screenX ?? 0),
    y: event.y - (interactionRef?.screenY ?? 0),
  });

  const rowIndexForPointer = (
    localY: number,
    currentScroll = untrack(scrollTop)
  ) => rowIndexAtOffset(rowEnds(), currentScroll + localY);

  // The pointer's row within the viewport, from its last move. Content that scrolls under a still
  // Pointer changes what is under it, so the hovered row is read against the live scroll.
  const [pointerY, setPointerY] = createSignal<number | undefined>(undefined);

  // One interaction layer covers every row, so the pointer is read off the row it is over: a
  // Marker folds on a click, code selects as text, and the gutter and separators do neither.
  const layer = hoverable((event) => {
    const pointer = localPointer(event);
    const row = rows()[rowIndexForPointer(pointer.y) ?? -1];

    if (row === undefined) {
      return "default";
    }

    if (!isLineRow(row)) {
      return row.kind === "marker" ? "pointer" : "default";
    }

    return pointer.x < gutterWidth() ? "default" : "text";
  });

  // OpenTUI re-checks the hit target after a frame, but the target here is always this one layer,
  // So content that scrolls under a still pointer would keep the style of the row that left.
  createEffect(
    on([scrollTop, scrollX], () => {
      if (untrack(layer.hovered)) {
        retrackPointer();
      }
    })
  );

  const markerHovered = (index: number) => {
    const y = pointerY();

    return (
      layer.hovered() &&
      y !== undefined &&
      rowIndexForPointer(y, scrollTop()) === index &&
      rows()[index]?.kind === "marker"
    );
  };

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

  const selectTo = (focus: SelectionPoint) => {
    if (press === undefined) {
      return;
    }

    // Once it selects, the selection holds the anchor: a refresh moves it with its text, or drops
    // It, and the gesture with it.
    const held = selecting ? state.viewerSelection() : press;

    if (held === undefined) {
      endDrag();

      return;
    }

    selecting = true;
    state.select({ anchor: held.anchor, focus, unit: held.unit });
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
    if (pressOnlyClosesMenu(event)) {
      state.closeCommandMenu();

      return false;
    }

    // A press that leaves the cursor where it is drifts nothing the menu's guard watches.
    state.closeCommandMenu();
    endDrag();
    state.setFocusedPane("diff");

    const pointer = localPointer(event);
    const rowIndex = rowIndexForPointer(pointer.y);
    const row = rowIndex === undefined ? undefined : rows()[rowIndex];
    const point = pointAt(pointer);

    if (row === undefined || point === undefined) {
      if (isLeftClick(event)) {
        state.clearSelection();
      }

      return false;
    }

    // A right-click opens the menu on whatever it hit; on a marker, the caret takes the line the
    // Marker sits against. Only a left press folds or unfolds.
    if (isRightClick(event)) {
      // The menu acts on a selection it opens over, so the press keeps it.
      if (!isOnSelection(point)) {
        state.setCursorRow(point.index);
      }

      return true;
    }

    if (!isLineRow(row)) {
      toggleMarker(row);

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

  // A press belongs to the content it landed on, as a selection does.
  createEffect(
    on(
      [state.selectedPath, state.scopeIdentity, state.repoRoot],
      () => {
        endDrag();
      },
      { defer: true }
    )
  );

  // A refresh under a held button moves a press that has not selected yet, as it does a selection.
  createEffect(
    on(state.navigableLines, (lines, before) => {
      if (press === undefined || selecting || before === undefined) {
        return;
      }

      const followed = followLines(before, lines, {
        ...press,
        focus: press.anchor,
      });

      if (followed === undefined) {
        endDrag();
      } else {
        press = { anchor: followed.anchor, unit: followed.unit };
      }
    })
  );

  // Keep the cursor's row inside the viewport by scrolling to it, with a
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

    if (cursorRow === undefined) {
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

  // Scroll a requested range of the caret line into view: sideways, or in wrap mode down to its
  // Wrapped row, since a line can be taller than the viewport. The request is consumed here, so it
  // Never fights a later scroll.
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

      return;
    }

    const rowIndex = lineRowIndices()[state.cursorIndex()] ?? 0;
    const row = rows()[rowIndex];

    if (row === undefined || !isLineRow(row)) {
      return;
    }

    const wrappedRow = measurer().visualRowForOffset(
      rowText(row),
      contentWidth(),
      range.from
    );

    setScrollTop((current) =>
      followScrollTop({
        current,
        height: 1,
        margin: CURSOR_SCROLL_MARGIN,
        maxScroll: maxScrollY(),
        top: (rowEnds()[rowIndex - 1] ?? 0) + wrappedRow,
        viewport: state.viewerHeight(),
      })
    );
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
      <box width="100%" height={state.viewerHeight()} overflow="hidden">
        {/* The slice paints at its own content offset less the scroll, so a tall wrapped row can
            start above the viewport. */}
        <box
          position="absolute"
          left={0}
          top={window().top - scrollTop()}
          width="100%"
          flexDirection="column"
        >
          <Index each={visibleRows()}>
            {(row, rowIndex) => (
              <Show
                when={asLineRow(row())}
                fallback={
                  <box
                    width="100%"
                    height={1}
                    flexShrink={0}
                    backgroundColor={theme.colors.surface.panel}
                  >
                    <text
                      selectable={false}
                      fg={
                        markerHovered(window().start + rowIndex)
                          ? theme.colors.text.primary
                          : theme.colors.text.faint
                      }
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
                    flexShrink={0}
                    // The height the window and every pointer mapping count this row as.
                    height={heights()[window().start + rowIndex] ?? 1}
                  >
                    <text
                      selectable={false}
                      flexShrink={0}
                      fg={changeBarColor(line())}
                      bg={gutterBackground(line())}
                    >
                      {changeBar(line())}
                    </text>
                    <text
                      selectable={false}
                      flexShrink={0}
                      fg={gutterNumberColor(line())}
                      bg={gutterBackground(line())}
                    >
                      {`${lineLabel(line())} `}
                    </text>
                    <box
                      width={contentWidth()}
                      flexShrink={0}
                      overflow="hidden"
                      backgroundColor={contentBackground(line())}
                    >
                      <StyledLine
                        row={line()}
                        wrap={wrap()}
                        width={
                          wrap()
                            ? contentWidth()
                            : Math.max(contentWidth(), longestLine())
                        }
                        scrollX={wrap() ? 0 : scrollX()}
                        selected={selectedOffsets(line())}
                        lifted={isCodeLifted(line())}
                      />
                    </box>
                  </box>
                )}
              </Show>
            )}
          </Index>
        </box>
      </box>
      <box
        ref={(el) => {
          interactionRef = el;
          layer.ref(el);
        }}
        position="absolute"
        left={0}
        top={0}
        width="100%"
        height={state.viewerHeight()}
        backgroundColor={theme.rgba.transparent}
        zIndex={1}
        onMouseScroll={onWheel}
        onMouseMove={(event: MouseEvent) => {
          setPointerY(localPointer(event).y);
        }}
        onMouseDown={(event: MouseEvent) => {
          // Any other button is the pane's: a middle press only focuses it, a side button steps
          // History.
          if (!isLeftClick(event) && !isRightClick(event)) {
            return;
          }

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
