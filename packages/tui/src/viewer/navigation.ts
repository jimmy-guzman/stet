// The viewer's navigation model: a set of tabs, each an ordered history of the
// Locations it has visited, plus a global most-recently-used viewport per path.
// Back/forward, tabs, and remembered-scroll are the same mechanism seen three
// Ways: a Location is what restores the viewer, a Tab is a history of Locations.
// This module is pure (no Solid/Effect/OpenTUI), so the stack/index/truncation
// And MRU logic is unit-testable without rendering; `state` owns the live signals
// That capture a Location on leave and apply one on arrive.

interface Viewport {
  scrollTop: number;
  scrollX: number;
}

// A remembered position for a path: where the cursor and viewport last sat. The
// Cursor is a file line (a NavigableLine.newLine), stable across refreshes, not a
// Navigable index (which only has meaning against a loaded diff).
export interface Position {
  cursorLine: number | undefined;
  // The caret's raw UTF-16 offset on the cursor line, stored and restored verbatim
  // (usually a word start, but a search jump can land it in a gap); the
  // Word-anchor/highlight is derived at render time, never baked into this value.
  // Undefined means "the line's first word", mirroring how `cursorLine: undefined`
  // Means "first change" — so a fresh open lands the caret at the first symbol.
  cursorColumn?: number;
  viewport: Viewport;
}

export interface Location extends Position {
  path: string;
  fileView: boolean;
  fullContent: boolean;
  // How this entry was reached: continuous tree browsing coalesces into one
  // `browse` entry; a deliberate open (enter, palette, search, jump) `pushes`.
  kind: "browse" | "jump";
}

interface Tab {
  id: string;
  entries: Location[];
  // Index of the current entry; -1 when the tab has no entries yet.
  index: number;
  // The ephemeral "preview" tab that browsing replaces in place. At most one
  // Exists; `pinTab` promotes it to a persistent tab (`preview: false`).
  preview: boolean;
}

export interface NavState {
  tabs: Tab[];
  activeTabId: string;
  // Global last-known position per path, shared across tabs, so a fresh
  // Navigation to a path you have visited restores where you were.
  viewports: Map<string, Position>;
}

export const initialNav = (
  location: Location | undefined,
  tabId = "0"
): NavState => ({
  activeTabId: tabId,
  tabs: [
    {
      entries: location === undefined ? [] : [location],
      id: tabId,
      index: location === undefined ? -1 : 0,
      preview: true,
    },
  ],
  viewports: new Map(),
});

// Promote a tab to a persistent (pinned) tab; idempotent on an already-pinned one.
export const pinTab = (nav: NavState, id: string): NavState => ({
  ...nav,
  tabs: nav.tabs.map((tab) =>
    tab.id === id ? { ...tab, preview: false } : tab
  ),
});

// Revert a pinned tab to the preview, discarding any other (ephemeral) preview so
// At most one remains. The reverted tab keeps its history and stays active.
export const unpinTab = (nav: NavState, id: string): NavState => {
  if (!nav.tabs.some((tab) => tab.id === id)) {
    return nav;
  }
  const flipped = nav.tabs.map((tab) =>
    tab.id === id ? { ...tab, preview: true } : tab
  );
  return {
    ...nav,
    tabs: flipped.filter((tab) => tab.id === id || !tab.preview),
  };
};

const activeTab = (nav: NavState) =>
  nav.tabs.find((tab) => tab.id === nav.activeTabId) ?? nav.tabs[0];

export const currentLocation = (nav: NavState): Location | undefined => {
  const tab = activeTab(nav);
  return tab.index < 0 ? undefined : tab.entries[tab.index];
};

export const canBack = (nav: NavState) => activeTab(nav).index > 0;

export const canForward = (nav: NavState) => {
  const tab = activeTab(nav);
  return tab.index < tab.entries.length - 1;
};

const mapActive = (nav: NavState, fn: (tab: Tab) => Tab): NavState => ({
  ...nav,
  tabs: nav.tabs.map((tab) => (tab.id === nav.activeTabId ? fn(tab) : tab)),
});

// Overwrite the active tab's current entry with the location being left, so a
// Later back/forward restores the exact spot. A no-op on an empty tab.
export const recordCurrent = (nav: NavState, location: Location): NavState =>
  mapActive(nav, (tab) =>
    tab.index < 0
      ? tab
      : {
          ...tab,
          entries: tab.entries.map((entry, index) =>
            index === tab.index ? location : entry
          ),
        }
  );

// Two entries occupy the same visible spot when they show the same line of the
// Same file under the same view mode; column is a within-line nicety, not a move.
const sameVisibleLocation = (a: Location, b: Location) =>
  a.path === b.path &&
  a.cursorLine === b.cursorLine &&
  a.fileView === b.fileView;

// Move to a new location in the active tab. Replace the head entry in place
// (keeping the index and any forward entries) rather than pushing in two cases:
// Re-navigating to the head's own visible spot (a jump between references on the
// Same line — you did not move, so the redo stack stays intact, matching IDE
// Navigation), or arrowing the tree, where a `browse` onto a `browse` head at the
// End of the stack collapses into one entry. Anything else pushes, truncating any
// Forward entries (browser semantics).
export const navigate = (nav: NavState, location: Location): NavState =>
  mapActive(nav, (tab) => {
    const head = tab.entries[tab.index];
    const replaceHead =
      head !== undefined &&
      (sameVisibleLocation(head, location) ||
        (location.kind === "browse" &&
          head.kind === "browse" &&
          tab.index === tab.entries.length - 1));
    if (replaceHead) {
      return {
        ...tab,
        entries: tab.entries.map((entry, index) =>
          index === tab.index ? location : entry
        ),
      };
    }
    const entries = [...tab.entries.slice(0, tab.index + 1), location];
    return { ...tab, entries, index: entries.length - 1 };
  });

export const back = (nav: NavState): NavState =>
  mapActive(nav, (tab) =>
    tab.index > 0 ? { ...tab, index: tab.index - 1 } : tab
  );

export const forward = (nav: NavState): NavState =>
  mapActive(nav, (tab) =>
    tab.index < tab.entries.length - 1 ? { ...tab, index: tab.index + 1 } : tab
  );

// Append a tab seeded with `location` and make it active. The caller supplies the
// Id (state owns the counter) and whether it is a preview tab; switching off the
// Previous tab is the caller's job (recordCurrent), the same capture-on-leave the
// Back/forward actions do. A new preview tab drops any existing one, so the
// At-most-one-preview invariant holds regardless of the caller.
export const openTab = (
  nav: NavState,
  location: Location,
  id: string,
  preview: boolean
): NavState => {
  const tabs = preview ? nav.tabs.filter((tab) => !tab.preview) : nav.tabs;
  return {
    ...nav,
    activeTabId: id,
    tabs: [...tabs, { entries: [location], id, index: 0, preview }],
  };
};

// Remove a tab. A view always exists, so "closing" the last tab can't drop to
// Zero — it reverts that tab to the preview (exits tab mode) instead. Otherwise
// Closing the active tab activates its right neighbor, or the left if rightmost.
export const closeTab = (nav: NavState, id: string): NavState => {
  if (nav.tabs.length <= 1) {
    return unpinTab(nav, id);
  }
  const index = nav.tabs.findIndex((tab) => tab.id === id);
  if (index === -1) {
    return nav;
  }
  const tabs = nav.tabs.filter((tab) => tab.id !== id);
  const activeTabId =
    nav.activeTabId === id
      ? (tabs[index] ?? tabs[index - 1] ?? tabs[0]).id
      : nav.activeTabId;
  return { ...nav, activeTabId, tabs };
};

export const selectTab = (nav: NavState, id: string): NavState =>
  nav.tabs.some((tab) => tab.id === id) ? { ...nav, activeTabId: id } : nav;

export const nextTab = (nav: NavState): NavState => {
  const index = nav.tabs.findIndex((tab) => tab.id === nav.activeTabId);
  return { ...nav, activeTabId: nav.tabs[(index + 1) % nav.tabs.length].id };
};

export const prevTab = (nav: NavState): NavState => {
  const index = nav.tabs.findIndex((tab) => tab.id === nav.activeTabId);
  return {
    ...nav,
    activeTabId: nav.tabs[(index - 1 + nav.tabs.length) % nav.tabs.length].id,
  };
};

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
