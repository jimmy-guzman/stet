import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { batch } from "solid-js";

import type { ChangedFile } from "@/git/model";
import { defaultExpandedDirectories } from "@/git/tree";
import { state } from "@/state";

import {
  createFixtureRepo,
  loadGitShowContent,
  loadModel,
  runGit,
  seedState,
} from "./helpers";

const paths = () =>
  state.treeSlice(0, state.treeRowCount()).map((row) => row.node.path);

const change = (filename: string): ChangedFile => ({
  additions: 1,
  binary: false,
  deletions: 0,
  kind: "modified",
  mtimeMs: 0,
  path: filename,
  stage: "unstaged",
  warnings: [],
});

const seedFiles = (files: string[], changed: ChangedFile[] = []) => {
  state.setGitModel({
    ...state.gitModel(),
    changed,
    changedByPath: new Map(changed.map((file) => [file.path, file])),
    repoFiles: files.map((filename) => ({
      path: filename,
      symlink: false,
      tracked: true,
    })),
    repoFilesKey: "loaded",
  });
};

test("deferred paths receive expansion and focus without opening a file", () => {
  state.setExpandedDirectories(defaultExpandedDirectories(["src/deep/a"]));
  state.focusTreeNode("file:src/deep/a");
  expect(state.treeRowCount()).toBe(0);
  seedFiles(["src/deep/a", "src/b"]);
  expect(state.focusedTreeRow()?.node.path).toBe("src/deep/a");
  expect(state.selectedPath()).toBeUndefined();
});

test("filter and scope refreshes preserve expansion, opened file, and history", () => {
  const files = ["src/deep/a", "src/b", "other/c"];
  seedFiles(files, [change("other/c")]);
  state.selectFile("src/deep/a");
  state.setChangesOnly(true);
  expect(paths()).toEqual(["other"]);
  expect(state.selectedPath()).toBe("src/deep/a");
  const navigation = state.navState();
  state.setChangesOnly(false);
  expect(paths()).toContain("src/deep/a");
  expect(state.focusedTreeRow()?.node.path).toBe("src/deep/a");
  batch(() => {
    state.setScope({ kind: "staged", ref: "HEAD" });
    seedFiles(files, [{ ...change("src/b"), stage: "staged" }]);
  });
  expect(state.navState()).toBe(navigation);
  expect(state.selectedPath()).toBe("src/deep/a");
  expect(state.focusedTreeRow()?.node.path).toBe("src/deep/a");
});

test("content refreshes update decorations without changing the focused row or preview", () => {
  seedFiles(["src/a", "src/b"], [change("src/a")]);
  state.selectFile("src/b");
  const navigation = state.navState();
  const changed = [{ ...change("src/a"), additions: 42, warnings: ["large"] }];
  state.setGitModel({
    ...state.gitModel(),
    changed,
    changedByPath: new Map(changed.map((file) => [file.path, file])),
  });
  expect(state.treeSlice(0, 1)[0].node).toMatchObject({
    additions: 42,
    warnings: ["large"],
  });
  expect(state.focusedTreeRow()?.node.path).toBe("src/b");
  expect(state.navState()).toBe(navigation);
  expect(state.selectedPath()).toBe("src/b");
});

test("removing the focused file rehomes tree focus without navigating the viewer", () => {
  seedFiles(["a", "b", "c"]);
  state.selectFile("b");
  const navigation = state.navState();
  seedFiles(["a", "c"]);
  expect(state.focusedTreeRow()?.node.path).not.toBe("b");
  expect(state.focusedTreeRow()).toBeDefined();
  expect(state.selectedPath()).toBe("b");
  expect(state.navState()).toBe(navigation);
});

test("reset discards the tree even when the next repository uses the same paths", () => {
  seedFiles(["src/a", "src/b"]);
  state.selectFile("src/b");
  state.resetState();
  expect(state.treeRowCount()).toBe(0);
  seedFiles(["src/a", "src/b"]);
  expect(paths()).toEqual(["src"]);
  expect(state.focusedTreeRow()?.node.id).toBe("dir:src");
  expect(state.selectedPath()).toBeUndefined();
});

test("Git endpoint collisions deliver original paths to navigation and copy actions", async () => {
  const root = createFixtureRepo("stet-tree-collision-", { a: "old file\n" });
  runGit(root, ["rm", "a"]);
  mkdirSync(path.join(root, "a"));
  const filename = "a/雪 file.ts";
  writeFileSync(path.join(root, filename), "new file\n");
  const scope = { kind: "all", ref: "HEAD" } as const;
  const model = await loadModel(root, scope);
  seedState(model, scope);
  state.setRepoRoot("");
  expect(paths()).toEqual(["a", filename, "a"]);
  state.selectFile("a");
  expect(state.focusedTreeRow()?.node).toMatchObject({
    id: "file:a",
    changed: { kind: "deleted", stage: "staged" },
  });
  expect(
    await loadGitShowContent(root, state.selectedPath() ?? "")
  ).toMatchObject({ content: "old file" });
  state.openCommandMenu("tree");
  expect(
    state
      .commandMenuItems()
      .find((item) => item.action.kind === "copyReference")?.action
  ).toMatchObject({ path: "a" });
  state.closeCommandMenu();
  state.selectFile(filename);
  expect(state.selectedPath()).toBe(filename);
  state.openCommandMenu("tree");
  expect(
    state
      .commandMenuItems()
      .find((item) => item.action.kind === "copyReference")?.action
  ).toMatchObject({ path: filename });
});

test("folder activation toggles expansion and only file activation records a viewer jump", () => {
  seedFiles(["start", "src/deep/a", "src/b"]);
  state.selectFile("start");
  state.focusTreeNode("dir:src");
  state.activateTreeNode();
  expect(state.focusedTreeRow()?.node).toMatchObject({ expanded: true });
  expect(state.selectedPath()).toBe("start");
  expect(state.canGoBack()).toBe(false);
  state.moveFocus("right");
  state.activateTreeNode();
  expect(state.selectedPath()).toBe("start");
  state.focusTreeNode("file:src/deep/a");
  state.activateTreeNode();
  expect(state.selectedPath()).toBe("src/deep/a");
  expect(state.focusedTreeRow()?.node.path).toBe("src/deep/a");
  state.goBack();
  expect(state.selectedPath()).toBe("start");
  expect(state.canGoBack()).toBe(false);
});

test("filtering retains a collapsed parent and its expanded child", () => {
  seedFiles(["src/deep/a", "src/b", "other/a"], [change("other/a")]);
  state.selectFile("src/deep/a");
  state.focusTreeNode("dir:src");
  state.moveFocus("left");
  expect(state.focusedTreeRow()?.node).toMatchObject({
    path: "src",
    expanded: false,
  });
  const navigation = state.navState();
  state.setChangesOnly(true);
  expect(paths()).not.toContain("src");
  state.setChangesOnly(false);
  expect(state.focusedTreeRow()?.node).toMatchObject({
    path: "src",
    expanded: false,
  });
  expect(paths()).not.toContain("src/deep/a");
  expect(state.navState()).toBe(navigation);
  state.moveFocus("right");
  expect(paths()).toContain("src/deep/a");
});

test("filtering retains an opened flattened directory chain", () => {
  seedFiles(["src/deep/a", "other/a"], [change("other/a")]);
  state.focusTreeNode("dir:src/deep");
  state.moveFocus("right");
  expect(paths()).toContain("src/deep/a");
  state.setChangesOnly(true);
  state.setChangesOnly(false);
  expect(paths()).toContain("src/deep/a");
});
