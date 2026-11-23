import { describe, expect, test } from "bun:test";

import {
  back,
  canBack,
  canForward,
  currentLocation,
  forward,
  initialNav,
  navigate,
  recall,
  recordCurrent,
  remember,
} from "@/viewer/navigation";
import type { Location } from "@/viewer/navigation";

const loc = (
  path: string,
  kind: "browse" | "jump" = "jump",
  over: Partial<Location> = {}
): Location => ({
  cursorLine: undefined,
  fileView: false,
  fullContent: false,
  kind,
  path,
  viewport: { scrollTop: 0, scrollX: 0 },
  ...over,
});

const open = (
  nav: ReturnType<typeof initialNav>,
  path: string,
  kind: "browse" | "jump" = "jump"
) => navigate(nav, loc(path, kind));

describe("history stack", () => {
  test("a fresh open pushes a new current entry", () => {
    const nav = open(initialNav(loc("a")), "b");
    expect(currentLocation(nav)?.path).toBe("b");
    expect(canBack(nav)).toBe(true);
    expect(canForward(nav)).toBe(false);
  });

  test("back then forward returns to where you were", () => {
    const nav = open(open(initialNav(loc("a")), "b"), "c");
    const backOne = back(nav);
    expect(currentLocation(backOne)?.path).toBe("b");
    expect(canForward(backOne)).toBe(true);
    expect(currentLocation(forward(backOne))?.path).toBe("c");
  });

  test("back is bounded at the first entry, forward at the last", () => {
    const nav = open(initialNav(loc("a")), "b");
    const atStart = back(back(nav));
    expect(currentLocation(atStart)?.path).toBe("a");
    expect(canBack(atStart)).toBe(false);
    expect(currentLocation(back(atStart))?.path).toBe("a");

    const atEnd = forward(forward(nav));
    expect(currentLocation(atEnd)?.path).toBe("b");
    expect(canForward(atEnd)).toBe(false);
  });

  test("opening after going back truncates the forward entries", () => {
    const nav = open(open(initialNav(loc("a")), "b"), "c");
    const reopened = open(back(nav), "d");
    expect(currentLocation(reopened)?.path).toBe("d");
    expect(canForward(reopened)).toBe(false);
    // "c" is gone: forward no longer reaches it.
    expect(currentLocation(back(reopened))?.path).toBe("b");
  });
});

describe("jump dedup", () => {
  test("a jump to the current location refreshes in place, not a duplicate", () => {
    const start = initialNav(loc("a", "jump", { cursorLine: 5 }));

    const again = navigate(
      start,
      loc("a", "jump", {
        cursorLine: 5,
        viewport: { scrollTop: 8, scrollX: 0 },
      })
    );

    expect(again.entries).toHaveLength(1);
    expect(canBack(again)).toBe(false);
    // The current entry is refreshed with the new viewport rather than duplicated.
    expect(currentLocation(again)?.viewport.scrollTop).toBe(8);
  });

  test("re-navigating to the current entry keeps forward history", () => {
    // Entries a, b, c at index 2
    const nav = open(open(initialNav(loc("a")), "b"), "c");

    // Go back to "b", then navigate to the same visible "b": a no-op move must not
    // Truncate the forward "c".
    const restay = navigate(
      back(nav),
      loc("b", "jump", { cursorLine: undefined })
    );

    expect(canForward(restay)).toBe(true);
    expect(currentLocation(forward(restay))?.path).toBe("c");
  });

  test("jumps to distinct lines in one file stay distinct", () => {
    const nav = navigate(
      navigate(initialNav(loc("x")), loc("a", "jump", { cursorLine: 50 })),
      loc("a", "jump", { cursorLine: 80 })
    );

    expect(currentLocation(nav)?.cursorLine).toBe(80);
    expect(currentLocation(back(nav))?.cursorLine).toBe(50);
    expect(currentLocation(back(back(nav)))?.path).toBe("x");
  });
});

describe("browse coalescing", () => {
  test("consecutive browse entries collapse into one", () => {
    const nav = open(
      open(open(initialNav(loc("a")), "b", "browse"), "c", "browse"),
      "d",
      "browse"
    );

    expect(currentLocation(nav)?.path).toBe("d");
    // One step back from the coalesced browse head lands on the original "a".
    expect(currentLocation(back(nav))?.path).toBe("a");
    expect(canBack(back(nav))).toBe(false);
  });

  test("a jump after browsing pushes rather than coalescing", () => {
    const nav = open(open(initialNav(loc("a")), "b", "browse"), "c", "jump");
    expect(currentLocation(back(nav))?.path).toBe("b");
  });

  test("browse does not coalesce onto a forward-truncated middle entry", () => {
    // After going back, the head is not at the end of the stack, so a browse pushes.
    const nav = open(open(initialNav(loc("a")), "b", "browse"), "c");
    const browsed = open(back(nav), "d", "browse");
    expect(currentLocation(browsed)?.path).toBe("d");
    expect(currentLocation(back(browsed))?.path).toBe("b");
  });
});

describe("recordCurrent", () => {
  test("overwrites the current entry, so back restores the recorded spot", () => {
    const nav = open(initialNav(loc("a")), "b");

    const recorded = recordCurrent(
      nav,
      loc("b", "jump", {
        cursorLine: 42,
        viewport: { scrollTop: 9, scrollX: 3 },
      })
    );

    const backOne = back(recorded);
    // The "b" entry we left now carries the recorded cursor/scroll.
    expect(currentLocation(forward(backOne))?.cursorLine).toBe(42);
    expect(currentLocation(forward(backOne))?.viewport).toEqual({
      scrollTop: 9,
      scrollX: 3,
    });
  });

  test("is a no-op on empty history", () => {
    const empty = initialNav(undefined);
    expect(recordCurrent(empty, loc("a"))).toEqual(empty);
    expect(currentLocation(recordCurrent(empty, loc("a")))).toBeUndefined();
  });
});

describe("MRU viewports", () => {
  test("remember then recall returns the stored position", () => {
    const nav = remember(initialNav(loc("a")), "a", {
      cursorLine: 7,
      viewport: { scrollTop: 5, scrollX: 1 },
    });

    expect(recall(nav, "a")).toEqual({
      cursorLine: 7,
      viewport: { scrollTop: 5, scrollX: 1 },
    });
    expect(recall(nav, "b")).toBeUndefined();
  });

  test("a back entry's own viewport can differ from the MRU for that path", () => {
    // Leaving "a" records scroll 9 into its entry; a later visit bumps the MRU to
    // 20. Going back must restore the entry's 9, not the MRU's 20.
    const left = recordCurrent(
      initialNav(loc("a")),
      loc("a", "jump", { viewport: { scrollTop: 9, scrollX: 0 } })
    );

    const nav = remember(open(left, "b"), "a", {
      cursorLine: undefined,
      viewport: { scrollTop: 20, scrollX: 0 },
    });

    expect(currentLocation(back(nav))?.viewport.scrollTop).toBe(9);
    expect(recall(nav, "a")?.viewport.scrollTop).toBe(20);
  });
});

describe("initialNav", () => {
  test("seeds history with the given location", () => {
    const nav = initialNav(loc("a"));
    expect(nav.entries).toHaveLength(1);
    expect(currentLocation(nav)?.path).toBe("a");
    expect(canBack(nav)).toBe(false);
  });

  test("starts with empty history when there is no location", () => {
    const nav = initialNav(undefined);
    expect(nav.entries).toEqual([]);
    expect(currentLocation(nav)).toBeUndefined();
  });
});
