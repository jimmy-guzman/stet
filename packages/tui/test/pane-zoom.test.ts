import { expect, test } from "bun:test";

import { KeyEvent } from "@opentui/core";
import { batch } from "solid-js";

import { createKeyHandler } from "@/keymap";
import { state } from "@/state";

// Zoom follows focus, so the rule is one line: whichever pane is focused fills the band.
// The line that keeps it coherent is that actions changing pane *visibility* exit zoom,
// While actions that only move *focus* carry it.
const key = (name: string) =>
  new KeyEvent({
    ctrl: false,
    eventType: "press",
    meta: false,
    name,
    number: false,
    option: false,
    raw: "",
    sequence: "",
    shift: false,
    source: "raw",
  });

function wide() {
  batch(() => {
    state.setTerminalWidth(80);
    state.setTerminalHeight(40);
  });
}

test("zoom gives the focused pane the whole band and hides the rest", () => {
  wide();
  state.setFocusedPane("diff");
  expect(state.layout().sidebar.width).toBe(34);

  state.toggleZoom();

  expect(state.layout().viewer.width).toBe(80);
  expect(state.layout().viewer.height).toBe(38);
  expect(state.layout().sidebar.width).toBe(0);
  // The header and status rows are never zoomed away.
  expect(state.layout().header.height).toBe(1);
  expect(state.layout().status.height).toBe(1);
});

test("zoom never closes a pane, so unzooming restores the arrangement", () => {
  wide();
  state.growPane(); // 34 -> 36, a size that must survive the round trip

  state.toggleZoom();
  expect(state.sidebarOpen()).toBe(true); // Hidden, not closed

  state.toggleZoom();
  expect(state.layout().sidebar.width).toBe(36);
});

test("switching focus carries the zoom to the newly focused pane", () => {
  wide();
  state.setFocusedPane("diff");
  state.toggleZoom();
  expect(state.layout().viewer.width).toBe(80);

  state.setFocusedPane("tree");

  expect(state.layout().sidebar.width).toBe(80);
  expect(state.layout().viewer.width).toBe(0);
});

test("the problems panel zooms once it is focused", () => {
  wide();
  state.toggleProblems(); // Opens and focuses it
  expect(state.layout().problems.height).toBe(10);

  state.toggleZoom();

  expect(state.layout().problems.height).toBe(38);
  expect(state.layout().viewer.height).toBe(0);
});

test("toggling a pane's visibility exits zoom, so the toggle is never invisible", () => {
  wide();
  state.setFocusedPane("diff");
  state.toggleZoom();
  expect(state.layout().viewer.width).toBe(80);

  state.toggleSidebar();

  expect(state.zoomed()).toBe(false);
  expect(state.sidebarOpen()).toBe(false);
  expect(state.layout().viewer.width).toBe(80); // Full width, now because the tree is closed
});

test("opening the problems panel exits zoom rather than filling the screen with it", () => {
  wide();
  state.toggleZoom();

  state.toggleProblems();

  expect(state.zoomed()).toBe(false);
  expect(state.layout().problems.height).toBe(10);
  expect(state.layout().sidebar.width).toBe(34);
});

test("escape closes a zoomed panel without leaving the next pane zoomed", () => {
  wide();
  state.toggleProblems();
  state.toggleZoom();
  expect(state.layout().problems.height).toBe(38);
  const handle = createKeyHandler({ openInEditor: async () => {}, quit: () => {} });

  handle(key("escape"));

  // Escape closes the panel, which is a visibility change, so it must exit zoom too:
  // Otherwise the pane focus lands on silently fills the screen instead.
  expect(state.problemsOpen()).toBe(false);
  expect(state.zoomed()).toBe(false);
  expect(state.layout().sidebar.width).toBe(34);
  expect(state.layout().viewer.width).toBe(46);
});

test("zoom never resurrects a pane that is closed", () => {
  wide();
  state.toggleSidebar();
  expect(state.sidebarOpen()).toBe(false);
  const handle = createKeyHandler({ openInEditor: async () => {}, quit: () => {} });
  // `tab` focuses the tree without checking whether it is on screen, so focus can name a
  // Closed pane. Zoom must not take that at face value and paint the pane back.
  handle(key("tab"));
  expect(state.focusedPane()).toBe("tree");

  state.toggleZoom();

  // Pin that zoom is genuinely on: a closed sidebar renders the same widths either way,
  // So without this the case would still pass if zoom stopped engaging entirely.
  expect(state.zoomed()).toBe(true);
  expect(state.layout().sidebar.width).toBe(0);
  expect(state.layout().viewer.width).toBe(80);
});

test("the geometry keys are inert while zoomed, and write nothing behind it", () => {
  wide();
  state.toggleZoom();

  state.growPane();
  state.shrinkPane();
  state.resetPane();
  state.movePane();

  expect(state.sidebarPosition()).toBe("left");

  // The proof the writes were suppressed rather than merely hidden: unzooming shows the
  // Arrangement untouched. A write behind the zoom would surface here.
  state.toggleZoom();
  expect(state.layout().sidebar.width).toBe(34);
  expect(state.layout().sidebar.x).toBe(0);
});
