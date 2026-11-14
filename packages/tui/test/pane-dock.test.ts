import { expect, test } from "bun:test";

import { batch } from "solid-js";

import { state } from "@/state";

// Docking is what makes axis, step, minimum, and override follow a pane's *edge*
// Rather than its name, so these drive the public actions and read the rendered
// Rect back, never the signals. The preload resets state before every test.
const wide = () => {
  batch(() => {
    state.setTerminalWidth(80);
    state.setTerminalHeight(40);
  });
};

test("the move key walks the edges clockwise and four presses return home", () => {
  wide();
  expect(state.sidebarPosition()).toBe("left");

  state.movePane();
  expect(state.sidebarPosition()).toBe("top");
  state.movePane();
  expect(state.sidebarPosition()).toBe("right");
  state.movePane();
  expect(state.sidebarPosition()).toBe("bottom");
  state.movePane();
  expect(state.sidebarPosition()).toBe("left");
});

test("moving acts on the tree from the viewer too", () => {
  wide();
  state.setFocusedPane("diff");

  state.movePane();

  expect(state.sidebarPosition()).toBe("top");
});

test("a closed pane does not move", () => {
  wide();
  state.toggleSidebar();
  expect(state.sidebarOpen()).toBe(false);

  state.movePane();

  expect(state.sidebarPosition()).toBe("left");
  expect(state.sidebarOpen()).toBe(false);
});

test("a pane keeps a size per axis, so a round trip restores it", () => {
  wide();
  state.growPane();
  state.growPane();
  expect(state.layout().sidebar.width).toBe(38);

  // Left -> top, now sized in rows
  state.movePane();
  expect(state.layout().sidebar.height).toBe(10);
  state.growPane();
  state.growPane();
  expect(state.layout().sidebar.height).toBe(12);

  state.movePane();
  state.movePane();
  // Back to left
  state.movePane();
  expect(state.layout().sidebar.width).toBe(38);
});

test("the step follows the axis", () => {
  wide();
  // Left-docked, so it sizes in columns
  state.growPane();
  expect(state.layout().sidebar.width).toBe(36);

  // The tree is now top-docked, so it sizes in rows
  state.movePane();
  state.growPane();
  expect(state.layout().sidebar.height).toBe(11);
});

test("the minimum follows the axis: a top-docked tree closes at the row floor", () => {
  wide();
  // Top-docked, 10 rows
  state.movePane();
  expect(state.layout().sidebar.height).toBe(10);

  // Five shrinks reach the 5-row floor; the sixth would dip below it.
  for (let step = 0; step < 5; step += 1) {
    state.shrinkPane();
  }

  expect(state.sidebarOpen()).toBe(true);
  expect(state.layout().sidebar.height).toBe(5);

  state.shrinkPane();
  expect(state.sidebarOpen()).toBe(false);
});

test("reset clears only the docked axis", () => {
  wide();
  // A width the tree should still have when it comes back
  state.growPane();
  expect(state.layout().sidebar.width).toBe(36);

  // Left -> top
  state.movePane();
  state.growPane();
  state.resetPane();
  expect(state.layout().sidebar.height).toBe(10);

  state.movePane();
  state.movePane();
  state.movePane();
  expect(state.layout().sidebar.width).toBe(36);
});
