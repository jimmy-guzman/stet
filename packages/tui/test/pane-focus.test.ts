import { expect, test } from "bun:test";
import { join } from "node:path";

import { KeyEvent } from "@opentui/core";
import { batch } from "solid-js";

import { createKeyHandler } from "@/keymap";
import { state } from "@/state";

import { createFixtureRepo, loadModel, loadWorktrees, runGit, seedState } from "./helpers";

// `tab` walks the panes that are open, in the order they sit on screen. Two things follow from
// That and are what these cases pin: focus can never name a pane the user closed, and the walk
// Re-orders itself when `d` moves a pane rather than following a list that outlives the layout.
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

test("tab walks tree, viewer, panel and back in the default arrangement", () => {
  wide();
  state.toggleProblems();
  state.setFocusedPane("tree");

  state.focusNextPane();
  expect(state.focusedPane()).toBe("diff");
  state.focusNextPane();
  expect(state.focusedPane()).toBe("problems");
  state.focusNextPane();
  expect(state.focusedPane()).toBe("tree");
});

test("a closed panel is not a stop, so the walk is tree and viewer", () => {
  wide();
  expect(state.problemsOpen()).toBe(false);
  state.setFocusedPane("tree");

  state.focusNextPane();
  expect(state.focusedPane()).toBe("diff");
  state.focusNextPane();
  expect(state.focusedPane()).toBe("tree");
});

test("a collapsed tree is not a stop, so tab never focuses a pane nobody can see", () => {
  wide();
  state.toggleProblems();
  state.toggleSidebar();
  expect(state.sidebarOpen()).toBe(false);
  state.setFocusedPane("problems");

  state.focusNextPane();
  expect(state.focusedPane()).toBe("diff");
  state.focusNextPane();
  expect(state.focusedPane()).toBe("problems");
});

test("with only the viewer open the walk has one stop and tab is a no-op", () => {
  wide();
  state.toggleSidebar();

  state.focusNextPane();

  expect(state.focusedPane()).toBe("diff");
});

test("the search view is the viewer's stop, so the walk reaches the panel from it", () => {
  wide();
  state.toggleProblems();
  state.openSearch();
  expect(state.focusedPane()).toBe("search");

  state.focusNextPane();
  expect(state.focusedPane()).toBe("problems");
  state.focusNextPane();
  expect(state.focusedPane()).toBe("tree");
  state.focusNextPane();
  expect(state.focusedPane()).toBe("search");
});

test("moving a pane re-orders the walk to match the screen", () => {
  wide();
  state.toggleProblems();
  state.setFocusedPane("tree");
  // Two presses of `d` carry the tree left -> top -> right, so it now sits after the viewer
  // And before the bottom-docked panel, where a fixed tree-viewer-panel list would put it first.
  state.movePane();
  state.movePane();
  expect(state.sidebarPosition()).toBe("right");
  expect(state.layout().sidebar.x).toBeGreaterThan(state.layout().viewer.x);
  expect(state.layout().problems.y).toBeGreaterThan(state.layout().sidebar.y);

  state.setFocusedPane("diff");
  state.focusNextPane();
  expect(state.focusedPane()).toBe("tree");
  state.focusNextPane();
  expect(state.focusedPane()).toBe("problems");
  state.focusNextPane();
  expect(state.focusedPane()).toBe("diff");
});

test("tab in the search view cycles its fields and stays in the pane", () => {
  wide();
  state.toggleProblems();
  state.openSearch();
  expect(state.searchFocus()).toBe("query");
  const handle = createKeyHandler({ openInEditor: async () => {}, quit: () => {} });

  // The search view owns `tab` for its own three fields, so the pane walk never starts here.
  handle(key("tab"));
  expect(state.searchFocus()).toBe("glob");
  handle(key("tab"));
  expect(state.searchFocus()).toBe("results");
  handle(key("tab"));
  expect(state.searchFocus()).toBe("query");
  expect(state.focusedPane()).toBe("search");
});

// A .txt-only fixture keeps runChecks from spawning an LSP server into the shared runtime.
test("switching worktrees lands focus on the tree only while the tree is on screen", async () => {
  const repoRoot = createFixtureRepo("stet-pane-focus-switch-", { "notes.txt": "one\n" });
  const linkedRoot = join(repoRoot, ".wt");
  runGit(repoRoot, ["worktree", "add", "-b", "side-branch", linkedRoot]);
  const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
  seedState(model, { kind: "all", ref: "HEAD" });
  const worktrees = await loadWorktrees(repoRoot);
  const linked = worktrees.find((worktree) => worktree.branch === "side-branch");
  if (linked === undefined) {
    throw new Error("linked worktree missing");
  }
  state.toggleSidebar();
  expect(state.sidebarOpen()).toBe(false);

  await state.switchWorktree(linked);

  // The switch seeds the new worktree's focus, and seeding it to the tree unconditionally is
  // The other way focus used to end up on a pane that is not on screen.
  expect(state.focusedPane()).toBe("diff");
});
