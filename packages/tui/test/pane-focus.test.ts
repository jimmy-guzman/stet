import { expect, test } from "bun:test";
import path from "node:path";

import { KeyEvent } from "@opentui/core";
import { batch } from "solid-js";

import { createKeyHandler } from "@/keymap";
import { state } from "@/state";

import {
  createFixtureRepo,
  loadModel,
  loadWorktrees,
  runGit,
  seedState,
} from "./helpers";

// `tab` switches between the tree and the viewer, landing on the tree only while it is open, so
// Focus can never name a pane the user closed.
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

const wide = () => {
  batch(() => {
    state.setTerminalWidth(80);
    state.setTerminalHeight(40);
  });
};

test("tab switches between the tree and the viewer", () => {
  wide();
  state.setFocusedPane("tree");

  state.focusNextPane();
  expect(state.focusedPane()).toBe("diff");
  state.focusNextPane();
  expect(state.focusedPane()).toBe("tree");
});

test("with the tree collapsed tab is a no-op on the viewer", () => {
  wide();
  state.toggleSidebar();

  state.focusNextPane();

  expect(state.focusedPane()).toBe("diff");
});

test("the search view is the viewer's stop", () => {
  wide();
  state.openSearch();
  expect(state.focusedPane()).toBe("search");

  state.focusNextPane();
  expect(state.focusedPane()).toBe("tree");
  state.focusNextPane();
  expect(state.focusedPane()).toBe("search");
});

test("tab in the search view cycles its fields and stays in the pane", () => {
  wide();
  state.openSearch();
  expect(state.searchFocus()).toBe("query");
  const handle = createKeyHandler({
    openInEditor: async () => {},
    quit: () => {},
  });

  // The search view owns `tab` for its own three fields, so the pane walk never starts here.
  handle(key("tab"));
  expect(state.searchFocus()).toBe("glob");
  handle(key("tab"));
  expect(state.searchFocus()).toBe("results");
  handle(key("tab"));
  expect(state.searchFocus()).toBe("query");
  expect(state.focusedPane()).toBe("search");
});

test("switching worktrees lands focus on the tree only while the tree is on screen", async () => {
  const repoRoot = createFixtureRepo("stet-pane-focus-switch-", {
    "notes.txt": "one\n",
  });
  const linkedRoot = path.join(repoRoot, ".wt");
  runGit(repoRoot, ["worktree", "add", "-b", "side-branch", linkedRoot]);
  const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
  seedState(model, { kind: "all", ref: "HEAD" });
  const worktrees = await loadWorktrees(repoRoot);
  const linked = worktrees.find(
    (worktree) => worktree.branch === "side-branch"
  );
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
