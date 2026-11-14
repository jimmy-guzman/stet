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

/** One of the two panes: the dockable tree and the viewer it carves from. */
type PaneSlot = "tree" | "viewer";

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
  zoom: PaneSlot | undefined;
}

export interface Layout {
  header: Rect;
  sidebar: PaneRect;
  viewer: PaneRect;
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
export const horizontalDock = (position: Dock) =>
  position === "left" || position === "right";

// A manual extent is stored raw and only clamped here, so it never overflows a
// Shrunken terminal yet is restored intact when the terminal grows back. The
// Responsive default and a manual override share the clamp, so what must survive
// The carve holds in both cases; the outer floor covers a band too small to
// Satisfy both minimums, where the pane falls back to its own and takes what
// There is.
const clampExtent = (
  desired: number,
  available: number,
  paneMin: number,
  reserved: number
) =>
  Math.min(
    available,
    Math.max(
      paneMin,
      Math.min(desired, Math.max(paneMin, available - reserved))
    )
  );

/**
 * Slice the pane off its edge of the band and hand back what is left for the viewer.
 *
 * @param band - The area between the header and status rows, in absolute terminal cells.
 * @param pane - The pane to place; a closed one claims nothing and yields a zero rect.
 */
const carve = (band: Rect, pane: DockedPane) => {
  if (!pane.open) {
    return { band, rect: EMPTY_PANE };
  }

  if (horizontalDock(pane.position)) {
    const extent = clampExtent(
      pane.widthOverride ?? responsiveWidth(band.width),
      band.width,
      PANE_MIN_WIDTH,
      VIEWER_MIN_WIDTH
    );

    const leading = pane.position === "left";

    return {
      band: {
        ...band,
        width: band.width - extent,
        x: leading ? band.x + extent : band.x,
      },
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
    VIEWER_MIN_HEIGHT
  );

  const leading = pane.position === "top";

  return {
    band: {
      ...band,
      height: band.height - extent,
      y: leading ? band.y + extent : band.y,
    },
    rect: withContent({
      height: extent,
      width: band.width,
      x: band.x,
      y: leading ? band.y : band.y + band.height - extent,
    }),
  };
};

/**
 * Partition the terminal into the header row, the two panes, and the status row.
 *
 * @returns Every region in absolute terminal cells; a closed or zoomed-out pane is all zeros.
 */
export const computeLayout = (input: LayoutInput): Layout => {
  const header = {
    height: HEADER_ROWS,
    width: input.terminalWidth,
    x: 0,
    y: 0,
  };

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
      sidebar: input.zoom === "tree" ? withContent(band) : EMPTY_PANE,
      status,
      viewer: input.zoom === "viewer" ? withContent(band) : EMPTY_PANE,
    };
  }

  const sidebar = carve(band, input.sidebar);

  return {
    header,
    sidebar: sidebar.rect,
    status,
    viewer: withContent(sidebar.band),
  };
};
