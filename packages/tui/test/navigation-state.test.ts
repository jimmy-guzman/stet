import { afterEach, expect, test } from "bun:test";

import { batch } from "solid-js";

import type { GitModel } from "@/git/model";
import { state } from "@/state";
import { recall } from "@/viewer/navigation";

const modelWith = (paths: string[]): GitModel => ({
  branch: undefined,
  changed: [],
  changedByPath: new Map(),
  repoFiles: paths.map((path) => ({ path, symlink: false, tracked: true })),
  repoFilesKey: "k",
  repoRoot: "/x",
  scopeKey: "all:HEAD",
});

const seed = (paths: string[]) => {
  batch(() => {
    state.setChangesOnly(false);
    state.setExpandedDirectories(new Set<string>());
    state.setGitModel(modelWith(paths));
    state.setFocusedNodeId(`file:${paths[0]}`);
    state.seedNav(undefined);
  });
};

afterEach(() => {
  batch(() => {
    state.setGitModel(modelWith([]));
    state.setExpandedDirectories(new Set<string>());
    state.setFocusedNodeId("");
    state.seedNav(undefined);
  });
});

test("selectFile builds history that goBack and goForward walk", () => {
  seed(["a.ts", "b.ts", "c.ts"]);
  state.selectFile("a.ts");
  state.selectFile("b.ts");
  state.selectFile("c.ts");
  expect(state.selectedPath()).toBe("c.ts");
  expect(state.canGoBack()).toBe(true);
  expect(state.canGoForward()).toBe(false);

  state.goBack();
  expect(state.selectedPath()).toBe("b.ts");
  expect(state.canGoForward()).toBe(true);

  state.goBack();
  expect(state.selectedPath()).toBe("a.ts");
  expect(state.canGoBack()).toBe(false);

  state.goForward();
  expect(state.selectedPath()).toBe("b.ts");
});

test("leaving a file whose restore is still pending records the intended position, not stale live scroll", () => {
  seed(["a.ts", "b.ts", "c.ts"]);
  state.selectFile("b.ts");
  // The Viewer restore effect never runs under the bare state singleton, so b's
  // PendingRestore stays outstanding and the live scroll still holds the previous
  // File's value; capture must use the pending viewport, not this stray 99.
  state.setViewerScrollTop(99);

  state.selectFile("c.ts");

  expect(recall(state.navState(), "b.ts")?.viewport.scrollTop).toBe(0);
});

test("opening a file after going back truncates the forward history", () => {
  seed(["a.ts", "b.ts", "c.ts", "d.ts"]);
  state.selectFile("a.ts");
  state.selectFile("b.ts");
  state.selectFile("c.ts");

  state.goBack();
  expect(state.selectedPath()).toBe("b.ts");

  state.selectFile("d.ts");
  expect(state.selectedPath()).toBe("d.ts");
  expect(state.canGoForward()).toBe(false);
  state.goBack();
  expect(state.selectedPath()).toBe("b.ts");
});

test("repeated jumps to the same spot in a file don't stack dead history entries", () => {
  seed(["a.ts", "b.ts"]);
  state.selectFile("a.ts");
  state.selectFile("b.ts", { escalate: true, line: 5 });
  // A second jump to the very same line (e.g. cycling references/problems that all
  // Resolve to one location) must not insert a duplicate entry; back still reaches a.ts.
  state.selectFile("b.ts", { escalate: true, line: 5 });

  state.goBack();
  expect(state.selectedPath()).toBe("a.ts");
});

test("a jump seeds the target line, so back restores it rather than the first change", () => {
  seed(["a.ts", "b.ts"]);
  state.selectFile("a.ts");
  state.selectFile("b.ts", { escalate: true, line: 42 });
  state.selectFile("a.ts");

  state.goBack();
  expect(state.selectedPath()).toBe("b.ts");
  expect(state.pendingRestore()?.cursorLine).toBe(42);
});

test("a line jump into an already-pinned file seeds its history so back restores the prior line", () => {
  seed(["a.ts", "b.ts"]);
  state.selectFile("a.ts");
  // Preview history a -> b@10
  state.selectFile("b.ts", { escalate: true, line: 10 });
  // Pin b (its current entry is b@10)
  state.togglePinActiveTab();

  // Jump to b again at a different line; b is the pinned tab's current entry.
  state.selectFile("b.ts", { escalate: true, line: 42 });
  expect(state.selectedPath()).toBe("b.ts");
  expect(state.pendingRestore()?.cursorLine).toBe(42);
  // Still the one pinned tab, no dup
  expect(state.tabItems()).toHaveLength(1);

  // Back within the pinned tab returns to the pre-jump line, not the stale entry.
  state.goBack();
  expect(state.selectedPath()).toBe("b.ts");
  expect(state.pendingRestore()?.cursorLine).toBe(10);
});

test("re-focusing an already-pinned file with no line target keeps its own remembered spot", () => {
  seed(["a.ts", "b.ts"]);
  // Remember a.ts at line 7
  state.selectFile("a.ts", { escalate: true, line: 7 });
  // Pin a.ts
  state.togglePinActiveTab();
  // Fresh preview on b.ts
  state.selectFile("b.ts");
  expect(state.tabItems()).toHaveLength(2);

  // Already pinned, no line -> just refocus, no new tab
  state.selectFile("a.ts");
  expect(state.tabItems()).toHaveLength(2);
  expect(state.selectedPath()).toBe("a.ts");
  expect(state.tabItems().find((tab) => tab.active)?.preview).toBe(false);
  // The refocus restores a.ts's remembered line, not a reset to the first change.
  expect(state.pendingRestore()?.cursorLine).toBe(7);
});

test("consecutive tree browsing collapses to one history entry", () => {
  seed(["a.ts", "b.ts", "c.ts"]);
  state.selectFile("a.ts");
  state.moveFocus(1);
  state.moveFocus(1);
  expect(state.selectedPath()).toBe("c.ts");

  state.goBack();
  expect(state.selectedPath()).toBe("a.ts");
  expect(state.canGoBack()).toBe(false);
});

test("goBack enqueues a pendingRestore for the target path", () => {
  seed(["a.ts", "b.ts"]);
  state.selectFile("a.ts");
  state.selectFile("b.ts");
  expect(state.pendingRestore()?.path).toBe("b.ts");

  state.goBack();
  expect(state.pendingRestore()?.path).toBe("a.ts");
});

test("goBack and goForward are no-ops at the ends of history", () => {
  seed(["a.ts", "b.ts"]);
  state.selectFile("a.ts");
  state.goBack();
  expect(state.selectedPath()).toBe("a.ts");
  state.goForward();
  expect(state.selectedPath()).toBe("a.ts");
});

test("browsing replaces the preview tab instead of accumulating tabs", () => {
  seed(["a.ts", "b.ts", "c.ts"]);
  state.selectFile("a.ts");
  state.selectFile("b.ts");
  state.selectFile("c.ts");
  expect(state.tabItems().length).toBe(1);
  expect(state.tabItems()[0].preview).toBe(true);
  expect(state.selectedPath()).toBe("c.ts");
});

test("togglePinActiveTab pins, then the next navigation opens a fresh preview", () => {
  seed(["a.ts", "b.ts"]);
  state.selectFile("a.ts");
  state.togglePinActiveTab();
  expect(state.tabItems().length).toBe(1);
  expect(state.tabItems()[0].preview).toBe(false);

  // Opens a new preview tab, leaving a.ts pinned
  state.selectFile("b.ts");
  expect(state.tabItems().length).toBe(2);
  expect(state.selectedPath()).toBe("b.ts");
  expect(state.tabItems().filter((tab) => tab.preview)).toHaveLength(1);
});

test("togglePinActiveTab unpins a pinned tab back to the calm preview", () => {
  seed(["a.ts"]);
  state.selectFile("a.ts");
  // Pin
  state.togglePinActiveTab();
  expect(state.tabItems()[0].preview).toBe(false);

  // Unpin -> back to a single preview, no file change
  state.togglePinActiveTab();
  expect(state.tabItems().length).toBe(1);
  expect(state.tabItems()[0].preview).toBe(true);
  expect(state.selectedPath()).toBe("a.ts");
});

test("navigating to a pinned file focuses its tab, never duplicating", () => {
  seed(["a.ts", "b.ts"]);
  state.selectFile("a.ts");
  // Pin a.ts
  state.togglePinActiveTab();
  // Preview b.ts, two tabs
  state.selectFile("b.ts");
  expect(state.tabItems().length).toBe(2);

  // Already pinned -> focus it, no new tab
  state.selectFile("a.ts");
  expect(state.tabItems().length).toBe(2);
  expect(state.selectedPath()).toBe("a.ts");
  expect(state.tabItems().find((tab) => tab.active)?.preview).toBe(false);
});

test("each tab keeps its own history; back/forward stay within the active tab", () => {
  seed(["a.ts", "b.ts", "c.ts"]);
  state.selectFile("a.ts");
  // Preview history: a -> b
  state.selectFile("b.ts");
  // Pin b
  state.togglePinActiveTab();
  // Fresh preview on c
  state.selectFile("c.ts");

  state.activateTab(state.tabItems().find((tab) => !tab.preview)?.id ?? "");
  expect(state.selectedPath()).toBe("b.ts");
  // Within the pinned tab's own history
  state.goBack();
  expect(state.selectedPath()).toBe("a.ts");

  state.activateTab(state.tabItems().find((tab) => tab.preview)?.id ?? "");
  expect(state.selectedPath()).toBe("c.ts");
});

test("closeActiveTab returns to a neighbor; closing the sole tab reverts to preview", () => {
  seed(["a.ts", "b.ts"]);
  state.selectFile("a.ts");
  state.togglePinActiveTab();
  // Tab 1 preview on b, tab 0 pinned a
  state.selectFile("b.ts");
  expect(state.tabItems().length).toBe(2);

  // Closes the preview (b) -> neighbor pinned a
  state.closeActiveTab();
  expect(state.tabItems().length).toBe(1);
  expect(state.tabItems()[0].preview).toBe(false);
  expect(state.selectedPath()).toBe("a.ts");

  // Sole tab -> reverts to preview (exits tab mode)
  state.closeActiveTab();
  expect(state.tabItems().length).toBe(1);
  expect(state.tabItems()[0].preview).toBe(true);
  expect(state.selectedPath()).toBe("a.ts");
});
