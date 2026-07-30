// The one place terminal dimensions become pane geometry. Every renderer reads a
// Rect from here instead of re-deriving its own budget from the terminal size,
// Which is what let a pane's width live in five expressions across five files and
// Pinned the tree context menu to a hardcoded column. Kept free of Solid/OpenTUI
// So the geometry is unit-tested directly, the way `viewer/anchor.ts` is.

/**
 * Every edge a pane can dock to, in the clockwise order the move key walks. This tuple is the one
 * list: `Dock` derives from it and the config schema's literals are built from it, so an edge added
 * here reaches the type, the rotation, and the schema together and none can drift from the others.
 */
export const DOCKS = ["left", "top", "right", "bottom"] as const;

/** Which edge a pane docks to. The viewer is always the center, so it never carries one. */
export type Dock = (typeof DOCKS)[number];

/** One of the three panes: the two dockable ones and the viewer they carve from. */
export type PaneSlot = "problems" | "tree" | "viewer";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A bordered pane: its outer frame, plus the area inside the single-cell border. */
interface PaneRect extends Rect {
  content: Rect;
}

export interface DockedPane {
  open: boolean;
  position: Dock;
  /** Manual extent in columns, honored while docked left or right; null is the responsive default. */
  widthOverride: number | null;
  /** Manual extent in rows, honored while docked top or bottom; null is the responsive default. */
  heightOverride: number | null;
}

export interface LayoutInput {
  terminalWidth: number;
  terminalHeight: number;
  sidebar: DockedPane;
  problems: DockedPane;
  zoom: PaneSlot | undefined;
}

export interface Layout {
  header: Rect;
  sidebar: PaneRect;
  viewer: PaneRect;
  problems: PaneRect;
  status: Rect;
}

const HEADER_ROWS = 1;
const STATUS_ROWS = 1;

/** Narrowest a docked pane may become; shrinking past it closes the pane instead of clamping. */
export const PANE_MIN_WIDTH = 24;
/** Shortest a docked pane may become; shrinking past it closes the pane instead of clamping. */
export const PANE_MIN_HEIGHT = 5;
/** Columns the viewer is guaranteed, capping how wide a side dock can grow. */
const VIEWER_MIN_WIDTH = 28;
/** Rows the viewer is guaranteed: its border, its title row, and one line of content. */
const VIEWER_MIN_HEIGHT = 4;
/**
 * Rows a top- or bottom-docked pane takes without a manual size; the vertical peer of
 * `responsiveWidth`.
 */
export const PANE_DEFAULT_HEIGHT = 10;

const EMPTY: Rect = { height: 0, width: 0, x: 0, y: 0 };
const EMPTY_PANE: PaneRect = { ...EMPTY, content: EMPTY };

const withContent = (rect: Rect): PaneRect => ({
  ...rect,
  content: {
    height: Math.max(0, rect.height - 2),
    width: Math.max(0, rect.width - 2),
    x: rect.x + 1,
    y: rect.y + 1,
  },
});

/** A side dock's default: a third of what it is carving from, held between 34 and 54 columns. */
const responsiveWidth = (available: number) =>
  Math.max(34, Math.min(54, Math.floor(available * 0.34)));

/** Whether an edge sizes in columns; a top or bottom dock sizes in rows. */
export const horizontalDock = (position: Dock) => position === "left" || position === "right";

/**
 * Cells a later pane on the same axis still needs, so the first carve cannot spend the second's
 * minimum. Panes on one axis are carved in turn, and each clamp only sees the band as it stands, so
 * without this the pair walks the viewer under its floor while every carve looks correct alone.
 */
const siblingReserve = (pane: DockedPane, next: DockedPane) => {
  if (!next.open || horizontalDock(pane.position) !== horizontalDock(next.position)) {
    return 0;
  }
  return horizontalDock(next.position) ? PANE_MIN_WIDTH : PANE_MIN_HEIGHT;
};

// A manual extent is stored raw and only clamped here, so it never overflows a
// Shrunken terminal yet is restored intact when the terminal grows back. The
// Responsive default and a manual override share the clamp, so what must survive
// The carve holds in both cases; the outer floor covers a band too small to
// Satisfy every minimum, where the pane falls back to its own and takes what
// There is, which is what a single over-wide pane on a narrow terminal already did.
const clampExtent = (desired: number, available: number, paneMin: number, reserved: number) =>
  Math.min(
    available,
    Math.max(paneMin, Math.min(desired, Math.max(paneMin, available - reserved))),
  );

/**
 * Slice one pane off its edge of the band and hand back what is left for the next carve.
 *
 * @param band - The area still unclaimed, in absolute terminal cells.
 * @param pane - The pane to place; a closed one claims nothing and yields a zero rect.
 * @param reserve - Cells a later same-axis pane needs, kept free on top of the viewer's own floor.
 */
function carve(band: Rect, pane: DockedPane, reserve: number): { band: Rect; rect: PaneRect } {
  if (!pane.open) {
    return { band, rect: EMPTY_PANE };
  }
  if (horizontalDock(pane.position)) {
    const extent = clampExtent(
      pane.widthOverride ?? responsiveWidth(band.width),
      band.width,
      PANE_MIN_WIDTH,
      VIEWER_MIN_WIDTH + reserve,
    );
    const leading = pane.position === "left";
    return {
      band: { ...band, width: band.width - extent, x: leading ? band.x + extent : band.x },
      rect: withContent({
        height: band.height,
        width: extent,
        x: leading ? band.x : band.x + band.width - extent,
        y: band.y,
      }),
    };
  }
  const extent = clampExtent(
    pane.heightOverride ?? PANE_DEFAULT_HEIGHT,
    band.height,
    PANE_MIN_HEIGHT,
    VIEWER_MIN_HEIGHT + reserve,
  );
  const leading = pane.position === "top";
  return {
    band: { ...band, height: band.height - extent, y: leading ? band.y + extent : band.y },
    rect: withContent({
      height: extent,
      width: band.width,
      x: band.x,
      y: leading ? band.y : band.y + band.height - extent,
    }),
  };
}

/**
 * Partition the terminal into the header row, the three panes, and the status row.
 *
 * The problems panel carves before the sidebar, which is what makes a bottom-docked panel span the
 * full terminal while the tree runs full height beside the viewer: its findings are repo-wide and
 * it drives the tree, so it is a peer pane rather than something sitting under the viewer. That
 * order is also why a same-edge pair needs no special case, and why there is no separate
 * panel-alignment knob.
 *
 * @returns Every region in absolute terminal cells; a closed or zoomed-out pane is all zeros.
 */
export function computeLayout(input: LayoutInput): Layout {
  const header = { height: HEADER_ROWS, width: input.terminalWidth, x: 0, y: 0 };
  const status = {
    height: STATUS_ROWS,
    width: input.terminalWidth,
    x: 0,
    y: Math.max(HEADER_ROWS, input.terminalHeight - STATUS_ROWS),
  };
  const band: Rect = {
    height: Math.max(0, input.terminalHeight - HEADER_ROWS - STATUS_ROWS),
    width: input.terminalWidth,
    x: 0,
    y: HEADER_ROWS,
  };

  // Zoom is an input rather than a mutation of the open flags, so restoring is just
  // Clearing it and no key pressed while zoomed can strand a stale flag.
  if (input.zoom !== undefined) {
    return {
      header,
      problems: input.zoom === "problems" ? withContent(band) : EMPTY_PANE,
      sidebar: input.zoom === "tree" ? withContent(band) : EMPTY_PANE,
      status,
      viewer: input.zoom === "viewer" ? withContent(band) : EMPTY_PANE,
    };
  }

  const problems = carve(band, input.problems, siblingReserve(input.problems, input.sidebar));
  const sidebar = carve(problems.band, input.sidebar, 0);
  return {
    header,
    problems: problems.rect,
    sidebar: sidebar.rect,
    status,
    viewer: withContent(sidebar.band),
  };
}

/**
 * The three panes in screen reading order, top to bottom then left to right, which is the order
 * focus cycling walks so that `tab` follows what is on screen rather than a list that contradicts
 * it once a pane is re-docked.
 *
 * Read off placed rects instead of a table keyed by edge, because the edge alone does not decide
 * the order: the carve does. With the panel docked right and the tree on top the two share the
 * first row, so the panel falls between them, while the same tree against a bottom-docked panel
 * puts the panel last. A table would have to restate all sixteen pairings and could then disagree
 * with `carve`. Sizes only scale those rects and never reorder them, so the arrangement is read
 * from a nominal terminal where every pane is placed, which also keeps a pane that is closed,
 * zoomed away, or squeezed to nothing from sorting as if it sat at the origin.
 *
 * @param sidebar - The edge the tree holds.
 * @param problems - The edge the problems panel holds.
 * @returns All three slots, including panes that are currently closed; the caller filters.
 */
export function paneReadingOrder(sidebar: Dock, problems: Dock): PaneSlot[] {
  const placed = computeLayout({
    problems: { heightOverride: null, open: true, position: problems, widthOverride: null },
    sidebar: { heightOverride: null, open: true, position: sidebar, widthOverride: null },
    // Comfortably past every minimum, so both panes take their default extent and each lands
    // At its own edge; anything smaller could clamp a pane onto another's coordinates.
    terminalHeight: 60,
    terminalWidth: 200,
    zoom: undefined,
  });
  return (
    [
      ["tree", placed.sidebar],
      ["viewer", placed.viewer],
      ["problems", placed.problems],
    ] as const
  )
    .toSorted(([, left], [, right]) => left.y - right.y || left.x - right.x)
    .map(([slot]) => slot);
}
