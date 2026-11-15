import { afterEach, expect, test } from "bun:test";

import { batch } from "solid-js";

import type { GitModel } from "@/git/model";
import { state } from "@/state";

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

// State is a global singleton shared across test files; reset what seed() mutates
afterEach(() => {
  batch(() => {
    state.setGitModel(modelWith([]));
    state.setExpandedDirectories(new Set<string>());
    state.focusTreeNode("");
    state.seedNav(undefined);
  });
});

test("focusedRowIndex derives from the focused node and moving selects the file", () => {
  seed(["a.ts", "b.ts", "c.ts"]);
  expect(state.focusedRowIndex()).toBe(0);

  state.moveFocus("next");
  expect(state.focusedRowIndex()).toBe(1);
  expect(state.selectedPath()).toBe("b.ts");
});

test("consecutive moves advance by each step, not collapse", () => {
  seed(["a.ts", "b.ts", "c.ts"]);

  state.moveFocus("next");
  state.moveFocus("next");

  expect(state.focusedRowIndex()).toBe(2);
  expect(state.selectedPath()).toBe("c.ts");
});
