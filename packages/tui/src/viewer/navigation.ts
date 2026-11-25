// History records the viewer's live location on leave and restores it on
// arrival. A separate position per path remembers where to reopen each file.

interface Viewport {
  scrollTop: number;
  scrollX: number;
}

// File line numbers survive a diff reload. An old-side line can share its
// number with a different row on the new side.
export interface Position {
  cursorLine: number | undefined;
  cursorSide?: "old";
  // An unfinished visit can resume through history or a direct reopen.
  jump?: JumpTarget;
  viewport: Viewport;
}

export interface JumpTarget {
  line: number;
  // One-based column, scrolled into view once the file loads.
  column?: number;
  /** How far the match runs from the column; its first word when unknown. */
  length?: number;
  escalate?: boolean;
}

export interface Location extends Position {
  path: string;
  fileView: boolean;
  fullContent: boolean;
  // How this entry was reached: continuous tree browsing coalesces into one
  // `browse` entry; a deliberate open (enter, palette, search, jump) `pushes`.
  kind: "browse" | "jump";
}

export interface NavState {
  entries: Location[];
  // Index of the current entry, or -1 when history is empty.
  index: number;
  viewports: Map<string, Position>;
}

export const initialNav = (location: Location | undefined): NavState => ({
  entries: location === undefined ? [] : [location],
  index: location === undefined ? -1 : 0,
  viewports: new Map(),
});

export const currentLocation = (nav: NavState): Location | undefined =>
  nav.entries[nav.index];

export const canBack = (nav: NavState) => nav.index > 0;

export const canForward = (nav: NavState) => nav.index < nav.entries.length - 1;

export const recordCurrent = (nav: NavState, location: Location): NavState =>
  nav.index < 0
    ? nav
    : {
        ...nav,
        entries: nav.entries.map((entry, index) =>
          index === nav.index ? location : entry
        ),
      };

// Two entries occupy the same visible spot when they show the same line of the
// Same file under the same view mode.
const sameVisibleLocation = (a: Location, b: Location) =>
  a.path === b.path &&
  a.cursorLine === b.cursorLine &&
  a.cursorSide === b.cursorSide &&
  a.fileView === b.fileView;

// A jump to the same visible location preserves forward history. Consecutive
// tree browsing coalesces at the end of history. Other moves branch from the
// current entry and discard any forward entries.
export const navigate = (nav: NavState, location: Location): NavState => {
  const head = currentLocation(nav);

  if (
    head !== undefined &&
    (sameVisibleLocation(head, location) ||
      (location.kind === "browse" &&
        head.kind === "browse" &&
        !canForward(nav)))
  ) {
    return recordCurrent(nav, location);
  }

  const entries = [...nav.entries.slice(0, nav.index + 1), location];

  return { ...nav, entries, index: entries.length - 1 };
};

export const back = (nav: NavState): NavState =>
  canBack(nav) ? { ...nav, index: nav.index - 1 } : nav;

export const forward = (nav: NavState): NavState =>
  canForward(nav) ? { ...nav, index: nav.index + 1 } : nav;

export const remember = (
  nav: NavState,
  path: string,
  position: Position
): NavState => ({
  ...nav,
  viewports: new Map(nav.viewports).set(path, position),
});

export const recall = (nav: NavState, path: string): Position | undefined =>
  nav.viewports.get(path);
