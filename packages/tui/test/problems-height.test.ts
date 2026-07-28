import { expect, test } from "bun:test";

import { batch } from "solid-js";

import { state } from "@/state";

// The panel is the sidebar's peer: a manual size clamped only at layout time, and a
// Shrink past the minimum that closes the pane rather than clamping. These drive the
// Public actions with focus set, since "resize the focused pane" is the behavior.
function focusPanel() {
  batch(() => {
    state.setTerminalHeight(40);
    state.toggleProblems();
  });
}

test("with no override the panel takes the layout model's default", () => {
  focusPanel();

  expect(state.layout().problems.height).toBe(10);
});

test("opening the panel focuses it, and closing hands focus back to the tree", () => {
  focusPanel();
  expect(state.focusedPane()).toBe("problems");

  state.toggleProblems();
  expect(state.problemsOpen()).toBe(false);
  expect(state.focusedPane()).toBe("tree");
});

test("closing the panel never focuses a collapsed tree", () => {
  batch(() => {
    state.setTerminalHeight(40);
    state.toggleSidebar();
  });
  expect(state.sidebarOpen()).toBe(false);

  state.toggleProblems();
  state.toggleProblems();

  expect(state.focusedPane()).toBe("diff");
});

test("closing the panel leaves focus alone when it was somewhere else", () => {
  focusPanel();
  state.setFocusedPane("diff");

  state.collapseProblems();

  expect(state.problemsOpen()).toBe(false);
  expect(state.focusedPane()).toBe("diff");
});

test("growing and shrinking the focused panel steps by a row", () => {
  focusPanel();

  state.growPane();
  expect(state.layout().problems.height).toBe(11);

  state.shrinkPane();
  state.shrinkPane();
  expect(state.layout().problems.height).toBe(9);
});

test("resetting returns the panel to the default height", () => {
  focusPanel();
  state.growPane();
  state.growPane();
  expect(state.layout().problems.height).toBe(12);

  state.resetPane();
  expect(state.layout().problems.height).toBe(10);
});

test("shrinking past the minimum closes the panel instead of clamping", () => {
  focusPanel();

  for (let step = 0; step < 6; step += 1) {
    state.shrinkPane();
  }

  expect(state.problemsOpen()).toBe(false);
  expect(state.focusedPane()).toBe("tree");
});

test("growing is clamped so the viewer keeps its floor", () => {
  batch(() => {
    state.setTerminalHeight(20);
    state.toggleProblems();
  });

  for (let step = 0; step < 30; step += 1) {
    state.growPane();
  }

  // Header, status, and the viewer's four-row floor are all still on screen.
  expect(state.layout().problems.height).toBeLessThanOrEqual(20 - 2 - 4);
  expect(state.layout().viewer.height).toBeGreaterThanOrEqual(4);
});

test("the resize keys fall back to the sidebar from any other pane", () => {
  batch(() => {
    state.setTerminalWidth(80);
    state.setTerminalHeight(40);
    state.setFocusedPane("diff");
  });

  state.growPane();

  expect(state.layout().sidebar.width).toBe(36);
  expect(state.layout().problems.height).toBe(0);
});

test("a manual height survives the panel closing and reopening", () => {
  focusPanel();
  state.growPane();
  state.growPane();
  expect(state.layout().problems.height).toBe(12);

  state.toggleProblems();
  state.toggleProblems();

  expect(state.layout().problems.height).toBe(12);
});
