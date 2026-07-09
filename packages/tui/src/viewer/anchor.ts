// Pure placement math for a caret-anchored viewer decoration (the hover card,
// And later peek/gutter overlays): map the caret to its on-screen cell inside the
// Viewer content area, then place a fixed-size card next to it, clamped to the
// Viewport and flipped above the caret near the bottom edge. Kept free of
// Solid/OpenTUI so the geometry is unit-tested directly, the way `diff/follow.ts`
// Is, rather than only through the render harness.

export interface CaretAnchorInput {
  /** Cumulative terminal-row height of the rows above the caret's row. */
  cursorTop: number;
  /** Vertical scroll offset of the viewport (terminal rows). */
  scrollTop: number;
  /** Viewer content height (terminal rows). */
  viewportHeight: number;
  /** Viewer content width (cells). */
  viewportWidth: number;
  /** Columns left of the line text: the fixed gutter plus the one diff-sign column. */
  contentLeft: number;
  /** The caret word's start display column within the line content. */
  caretFrom: number;
  /** Horizontal scroll offset (display columns). */
  scrollX: number;
}

/**
 * The caret's cell, 0-based within the viewer content area, or undefined when it is scrolled out of
 * view.
 */
export interface CaretCell {
  row: number;
  col: number;
}

// The caret's row is its cumulative top minus the scroll, and its column the
// Content-left offset plus the word's display column shifted by the horizontal
// Scroll. Off-screen on either axis (above the fold or past the bottom; scrolled
// Left of the content or past the right edge) yields undefined so the decoration
// Hides rather than anchoring to a cell the user can't see.
export function caretCell({
  cursorTop,
  scrollTop,
  viewportHeight,
  viewportWidth,
  contentLeft,
  caretFrom,
  scrollX,
}: CaretAnchorInput): CaretCell | undefined {
  const row = cursorTop - scrollTop;
  if (row < 0 || row >= viewportHeight) {
    return undefined;
  }
  const col = contentLeft + caretFrom - scrollX;
  if (col < contentLeft || col >= viewportWidth) {
    return undefined;
  }
  return { col, row };
}

export interface CardPlacementInput {
  /** The caret cell to anchor against (0-based within the viewer content area). */
  anchor: CaretCell;
  /** Card width in cells. */
  cardWidth: number;
  /** Card height in rows. */
  cardHeight: number;
  /** Viewer content width in cells. */
  viewportWidth: number;
  /** Viewer content height in rows. */
  viewportHeight: number;
}

/** The card's top-left within the viewer content area, plus whether it was flipped above the caret. */
export interface CardPlacement {
  top: number;
  left: number;
  flipped: boolean;
}

// Prefer the row below the caret so the card never covers the line being inspected;
// Flip to end just above the caret when the card would overflow the bottom edge. The
// Left edge tracks the caret column, clamped so the card stays fully on screen (and
// Pinned to 0 when it is wider than the viewport).
export function placeCard({
  anchor,
  cardWidth,
  cardHeight,
  viewportWidth,
  viewportHeight,
}: CardPlacementInput): CardPlacement {
  const below = anchor.row + 1;
  const flipped = below + cardHeight > viewportHeight;
  const top = flipped ? Math.max(0, anchor.row - cardHeight) : below;
  const left = Math.max(0, Math.min(anchor.col, viewportWidth - cardWidth));
  return { flipped, left, top };
}
