// Pure placement math for the context menu: place a fixed-size card next to its anchor cell,
// Clamped to the viewport and flipped above the anchor near the bottom edge. Kept free of
// Solid/OpenTUI so the geometry is unit-tested directly, the way `diff/follow.ts`
// Is, rather than only through the render harness.

/** The cell a menu opens at, 0-based in the caller's coordinate frame. */
export interface AnchorCell {
  row: number;
  col: number;
}

export interface CardPlacementInput {
  anchor: AnchorCell;
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
// Left edge tracks the anchor column, clamped so the card stays fully on screen (and
// Pinned to 0 when it is wider than the viewport).
export const placeCard = ({
  anchor,
  cardWidth,
  cardHeight,
  viewportWidth,
  viewportHeight,
}: CardPlacementInput): CardPlacement => {
  const below = anchor.row + 1;
  const flipped = below + cardHeight > viewportHeight;
  const top = flipped ? Math.max(0, anchor.row - cardHeight) : below;
  const left = Math.max(0, Math.min(anchor.col, viewportWidth - cardWidth));

  return { flipped, left, top };
};
