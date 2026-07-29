import { expect, test } from "bun:test";

import { batch } from "solid-js";

import { state } from "@/state";

// Docking is what makes axis, step, minimum, and override follow a pane's *edge*
// Rather than its name, so these drive the public actions and read the rendered
// Rect back, never the signals. The preload resets state before every test.
function wide() {
  batch(() => {
    state.setTerminalWidth(80);
    state.setTerminalHeight(40);
  });
}

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

test("moving acts on the focused pane, and on the tree from anywhere else", () => {
  wide();
  state.toggleProblems(); // Opens and focuses the panel

  state.movePane();
  expect(state.problemsPosition()).toBe("left");
  expect(state.sidebarPosition()).toBe("left");

  state.setFocusedPane("diff");
  state.movePane();
  expect(state.sidebarPosition()).toBe("top");
  expect(state.problemsPosition()).toBe("left");
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

  state.movePane(); // Left -> top, now sized in rows
  expect(state.layout().sidebar.height).toBe(10);
  state.growPane();
  state.growPane();
  expect(state.layout().sidebar.height).toBe(12);

  state.movePane();
  state.movePane();
  state.movePane(); // Back to left
  expect(state.layout().sidebar.width).toBe(38);
});

test("the step follows the axis, not the pane", () => {
  wide();
  state.movePane(); // The tree is now top-docked, so it sizes in rows
  state.growPane();
  expect(state.layout().sidebar.height).toBe(11);

  state.toggleProblems();
  state.movePane(); // The panel is now left-docked, so it sizes in columns
  const before = state.layout().problems.width;
  state.growPane();
  expect(state.layout().problems.width).toBe(before + 2);
});

test("the minimum follows the axis: a top-docked tree closes at the row floor", () => {
  wide();
  state.movePane(); // Top-docked, 10 rows
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
  state.growPane(); // A width the tree should still have when it comes back
  expect(state.layout().sidebar.width).toBe(36);

  state.movePane(); // Left -> top
  state.growPane();
  state.resetPane();
  expect(state.layout().sidebar.height).toBe(10);

  state.movePane();
  state.movePane();
  state.movePane();
  expect(state.layout().sidebar.width).toBe(36);
});

test("both panes can share one edge, and the panel carves outermost", () => {
  wide();
  state.toggleProblems(); // Bottom-docked and focused
  state.setFocusedPane("diff");

  state.movePane(); // Left -> top
  state.movePane(); // -> right
  state.movePane(); // -> bottom, the edge the panel already holds
  expect(state.sidebarPosition()).toBe("bottom");
  expect(state.problemsPosition()).toBe("bottom");

  expect(state.problemsOpen()).toBe(true);
  expect(state.sidebarOpen()).toBe(true);
  expect(state.layout().problems.y).toBeGreaterThan(state.layout().sidebar.y);
});
