import { expect, test } from "bun:test";

import { state } from "@/state";

// The tree's half of the resize contract, the peer of `problems-height.test.ts`.
// Both drive the public actions with focus set, since "resize the focused pane" is
// The behavior; the tree is the default target, so these need no focus setup. The
// Preload resets state before every test, so nothing here has to undo itself.
const grow = (times: number) => {
  for (let step = 0; step < times; step += 1) {
    state.growPane();
  }
};
const shrink = (times: number) => {
  for (let step = 0; step < times; step += 1) {
    state.shrinkPane();
  }
};

test("with no override the width is the responsive default", () => {
  state.setTerminalWidth(80);

  expect(state.layout().sidebar.width).toBe(34);
});

test("on a medium terminal the auto width is capped so growing never shrinks it", () => {
  // At 60 cols the responsive default (34) exceeds the viewer-preserving max (32),
  // So it caps to 32 and a grow cannot push the rendered width below that.
  state.setTerminalWidth(60);
  expect(state.layout().sidebar.width).toBe(32);

  grow(1);
  expect(state.layout().sidebar.width).toBe(32);
});

test("resizing steps by two columns from the current width", () => {
  state.setTerminalWidth(80);

  grow(1);
  expect(state.layout().sidebar.width).toBe(36);

  shrink(2);
  expect(state.layout().sidebar.width).toBe(32);
});

test("growing is clamped to the viewer-preserving max", () => {
  state.setTerminalWidth(80);

  grow(20);

  expect(state.layout().sidebar.width).toBe(52);
});

test("shrinking step by step rests at the minimum before collapsing", () => {
  state.setTerminalWidth(80);

  // 34 -> 24 lands on the minimum, still open.
  shrink(5);
  expect(state.sidebarOpen()).toBe(true);
  expect(state.layout().sidebar.width).toBe(24);

  // One more step would dip below the minimum, so it collapses.
  shrink(1);
  expect(state.sidebarOpen()).toBe(false);
  expect(state.focusedPane()).not.toBe("tree");
});

test("reset returns to the responsive default", () => {
  state.setTerminalWidth(80);
  grow(2);
  expect(state.layout().sidebar.width).toBe(38);

  state.resetPane();

  expect(state.layout().sidebar.width).toBe(34);
});

test("a manual width survives the terminal shrinking and growing back", () => {
  state.setTerminalWidth(80);
  grow(8);
  expect(state.layout().sidebar.width).toBe(50);

  state.setTerminalWidth(40);
  expect(state.layout().sidebar.width).toBe(24);

  state.setTerminalWidth(80);
  expect(state.layout().sidebar.width).toBe(50);
});

test("a closed sidebar has zero width regardless of override", () => {
  state.setTerminalWidth(80);
  grow(8);

  state.setSidebarOpen(false);

  expect(state.layout().sidebar.width).toBe(0);
});

test("growing re-opens a sidebar collapsed by the toggle at its remembered width", () => {
  state.setTerminalWidth(80);
  grow(8); // 34 -> 50, stored
  state.toggleSidebar(); // Closing this way never touches the width

  grow(1);

  expect(state.sidebarOpen()).toBe(true);
  expect(state.layout().sidebar.width).toBe(50);
});

test("shrinking all the way down leaves the minimum as the remembered width", () => {
  state.setTerminalWidth(80);
  grow(8); // 34 -> 50

  shrink(20); // Steps down to 24, then one more step closes it
  expect(state.sidebarOpen()).toBe(false);

  // Reopening restores where the shrinking actually stopped, not where it began:
  // Every step wrote the override, so 50 was walked down long before the close.
  grow(1);
  expect(state.layout().sidebar.width).toBe(24);
});

test("shrinking a collapsed sidebar stays closed", () => {
  state.setTerminalWidth(80);
  shrink(20);
  expect(state.sidebarOpen()).toBe(false);

  shrink(1);

  expect(state.sidebarOpen()).toBe(false);
});
