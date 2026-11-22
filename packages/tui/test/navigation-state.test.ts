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
    state.focusTreeNode(`file:${paths[0]}`);
    state.seedNav(undefined);
  });
};

afterEach(() => {
  batch(() => {
    state.setGitModel(modelWith([]));
    state.setExpandedDirectories(new Set<string>());
    state.focusTreeNode("");
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

test("a line jump in the current file records both locations", () => {
  seed(["a.ts", "b.ts"]);
  state.selectFile("a.ts");
  state.selectFile("b.ts", { line: 10 });
  state.selectFile("b.ts", { line: 42 });

  expect(state.pendingRestore()?.cursorLine).toBe(42);

  state.goBack();
  expect(state.selectedPath()).toBe("b.ts");
  expect(state.pendingRestore()?.cursorLine).toBe(10);

  state.goForward();
  expect(state.selectedPath()).toBe("b.ts");
  expect(state.pendingRestore()?.cursorLine).toBe(42);
});

test("reopening a file restores its last caret and scroll", () => {
  seed(["a.ts", "b.ts"]);
  state.selectFile("a.ts", { line: 7 });
  state.setPendingRestore({
    cursorColumn: 3,
    cursorLine: 7,
    path: "a.ts",
    viewport: { scrollTop: 4, scrollX: 2 },
  });
  state.selectFile("b.ts");

  state.selectFile("a.ts");
  expect(state.pendingRestore()).toEqual({
    cursorColumn: 3,
    cursorLine: 7,
    path: "a.ts",
    viewport: { scrollTop: 4, scrollX: 2 },
  });
});

test("consecutive tree browsing collapses to one history entry", () => {
  seed(["a.ts", "b.ts", "c.ts"]);
  state.selectFile("a.ts");
  state.moveFocus("next");
  state.moveFocus("next");
  expect(state.selectedPath()).toBe("c.ts");

  state.goBack();
  expect(state.selectedPath()).toBe("a.ts");
  expect(state.canGoBack()).toBe(false);
});

test("a tree move at the file boundary preserves the deliberate open in history", () => {
  seed(["a.ts", "b.ts", "c.ts"]);
  state.selectFile("a.ts");
  state.selectFile("c.ts");
  state.moveFocus("next");
  state.moveFocus("previous");
  expect(state.selectedPath()).toBe("b.ts");

  state.goBack();
  expect(state.selectedPath()).toBe("c.ts");
});

test("deliberately opening the current browsed file makes it a history stop", () => {
  seed(["a.ts", "b.ts", "c.ts"]);
  state.selectFile("a.ts");
  state.moveFocus("next");
  state.selectFile("b.ts");
  state.moveFocus("next");
  expect(state.selectedPath()).toBe("c.ts");

  state.goBack();
  expect(state.selectedPath()).toBe("b.ts");
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
