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

/**
 * A pane: its outer rect, plus the area its content may paint. The viewer has no frame, so the two
 * match; the tree gives up the one cell where its divider is drawn.
 */
interface PaneRect extends Rect {
  content: Rect;
  /** The side the tree draws its divider on, facing the viewer; undefined when nothing faces it. */
  divider: Dock | undefined;
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
  /** The column where a side-docked tree's divider meets the header and status rules. */
  junction: number | undefined;
}

const HEADER_ROWS = 1;
const STATUS_ROWS = 1;

/** Narrowest a docked pane may become; shrinking past it closes the pane instead of clamping. */
export const PANE_MIN_WIDTH = 24;

/** Shortest a docked pane may become; shrinking past it closes the pane instead of clamping. */
export const PANE_MIN_HEIGHT = 5;

/** Columns the viewer is guaranteed, capping how wide a side dock can grow. */
const VIEWER_MIN_WIDTH = 28;

/** Rows the viewer is guaranteed: its title row and one line of content. */
const VIEWER_MIN_HEIGHT = 2;

/**
 * Rows a top- or bottom-docked pane takes without a manual size; the vertical peer of
 * `responsiveWidth`.
 */
export const PANE_DEFAULT_HEIGHT = 10;

/** Whether an edge sizes in columns; a top or bottom dock sizes in rows. */
export const horizontalDock = (position: Dock) =>
  position === "left" || position === "right";

const EMPTY: Rect = { height: 0, width: 0, x: 0, y: 0 };
const EMPTY_PANE: PaneRect = { ...EMPTY, content: EMPTY, divider: undefined };

const OPPOSITE = {
  bottom: "top",
  left: "right",
  right: "left",
  top: "bottom",
} as const satisfies Record<Dock, Dock>;

const unframed = (rect: Rect): PaneRect => ({
  ...rect,
  content: rect,
  divider: undefined,
});

/** The tree's rect with one cell given to the divider on the side facing the viewer. */
const divided = (rect: Rect, position: Dock): PaneRect => {
  const divider = OPPOSITE[position];

  return {
    ...rect,
    content: {
      height: Math.max(0, rect.height - (horizontalDock(position) ? 0 : 1)),
      width: Math.max(0, rect.width - (horizontalDock(position) ? 1 : 0)),
      x: rect.x + (divider === "left" ? 1 : 0),
      y: rect.y + (divider === "top" ? 1 : 0),
    },
    divider,
  };
};

/** A side dock's default: a third of what it is carving from, held between 34 and 54 columns. */
const responsiveWidth = (available: number) =>
  Math.max(34, Math.min(54, Math.floor(available * 0.34)));

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
      rect: divided(
        {
          height: band.height,
          width: extent,
          x: leading ? band.x : band.x + band.width - extent,
          y: band.y,
        },
        pane.position
      ),
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
    rect: divided(
      {
        height: extent,
        width: band.width,
        x: band.x,
        y: leading ? band.y : band.y + band.height - extent,
      },
      pane.position
    ),
  };
};

/**
 * The extent a docked pane takes when its divider is dragged to a terminal cell, along the dock's
 * axis. It passes through the same clamp `computeLayout` applies, so a drag past either limit
 * stores what is drawn rather than a value later presses would have to work back through.
 *
 * @param input - The layout's current inputs; only the terminal size and the dock edge are read.
 * @param point - The pointer's cell, in absolute terminal coordinates.
 */
export const draggedExtent = (
  input: LayoutInput,
  point: { x: number; y: number }
) => {
  const bandHeight = Math.max(
    0,
    input.terminalHeight - HEADER_ROWS - STATUS_ROWS
  );

  const reach = {
    bottom: HEADER_ROWS + bandHeight - point.y,
    left: point.x + 1,
    right: input.terminalWidth - point.x,
    top: point.y - HEADER_ROWS + 1,
  } satisfies Record<Dock, number>;

  return horizontalDock(input.sidebar.position)
    ? clampExtent(
        reach[input.sidebar.position],
        input.terminalWidth,
        PANE_MIN_WIDTH,
        VIEWER_MIN_WIDTH
      )
    : clampExtent(
        reach[input.sidebar.position],
        bandHeight,
        PANE_MIN_HEIGHT,
        VIEWER_MIN_HEIGHT
      );
};

/** The column a vertical divider occupies; a top or bottom dock's divider meets no rule. */
const junctionOf = (pane: PaneRect) => {
  if (pane.divider === "right") {
    return pane.x + pane.width - 1;
  }

  return pane.divider === "left" ? pane.x : undefined;
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
      junction: undefined,
      sidebar: input.zoom === "tree" ? unframed(band) : EMPTY_PANE,
      status,
      viewer: input.zoom === "viewer" ? unframed(band) : EMPTY_PANE,
    };
  }

  const sidebar = carve(band, input.sidebar);

  return {
    header,
    junction: junctionOf(sidebar.rect),
    sidebar: sidebar.rect,
    status,
    viewer: unframed(sidebar.band),
  };
};
