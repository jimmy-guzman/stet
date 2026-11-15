import { afterEach, describe, expect, test } from "bun:test";

import type { ChangedFile, RepoFile } from "@/git/model";
import { defaultExpandedDirectories } from "@/git/tree";
import { createTreeModel } from "@/tree/model";

const models: ReturnType<typeof createTreeModel>[] = [];

const filesFor = (paths: string[]) =>
  new Map<string, RepoFile>(
    paths.map((path) => [path, { path, symlink: false, tracked: true }])
  );

const modelFor = (paths: string[], expanded = new Set<string>()) => {
  const model = createTreeModel();
  models.push(model);
  model.setExpanded(expanded);
  model.syncPaths(filesFor(paths));

  return model;
};

afterEach(() => {
  for (const model of models.splice(0)) {
    model.cleanUp();
  }
});

const changed = (
  path: string,
  overrides: Partial<ChangedFile> = {}
): ChangedFile => ({
  additions: 1,
  binary: false,
  deletions: 0,
  kind: "modified",
  mtimeMs: 0,
  path,
  stage: "unstaged",
  warnings: [],
  ...overrides,
});

describe("terminal tree model", () => {
  test("uses Trees natural ordering with directories first and case-insensitive names", () => {
    const model = modelFor([
      "z/child",
      "a",
      "A",
      "f2",
      "f10",
      "aDir/child",
      "README.md",
    ]);

    expect(model.rows(0, 20).map((row) => row.node.name)).toEqual([
      "aDir",
      "z",
      "A",
      "a",
      "f2",
      "f10",
      "README.md",
    ]);
  });
  test("flattens chains and reports visual depths", () => {
    const paths = ["src/App.tsx", "src/components/ui/Button.tsx", "README.md"];
    const model = modelFor(paths, defaultExpandedDirectories(paths));
    expect(
      model.rows(0, 20).map(({ depth, node }) => [depth, node.id, node.name])
    ).toEqual([
      [0, "dir:src", "src"],
      [1, "dir:src/components/ui", "components/ui"],
      [2, "file:src/components/ui/Button.tsx", "Button.tsx"],
      [1, "file:src/App.tsx", "App.tsx"],
      [0, "file:README.md", "README.md"],
    ]);
  });
  test("translates inclusive windows and handles empty or zero-height panes", () => {
    const model = modelFor(["a", "b", "c", "d"]);
    expect(model.rows(1, 2).map((row) => [row.index, row.node.path])).toEqual([
      [1, "b"],
      [2, "c"],
    ]);
    expect(model.rows(3, 20).map((row) => row.node.path)).toEqual(["d"]);
    expect(model.rows(0, 0)).toEqual([]);
    expect(model.rows(9, 2)).toEqual([]);
    const empty = modelFor([]);
    expect(empty.rowCount()).toBe(0);
    empty.move("next");
    expect(empty.focusedRow()).toBeUndefined();
  });
  test("reveals files under collapsed ancestors and navigates visible rows", () => {
    const model = modelFor(["src/ui/a.ts", "src/b.ts"]);
    model.reveal("src/ui/a.ts");
    expect(model.focusedRow()?.node.path).toBe("src/ui/a.ts");
    model.move("next");
    expect(model.focusedRow()?.node.path).toBe("src/b.ts");
    model.move("previous");
    expect(model.focusedRow()?.node.path).toBe("src/ui/a.ts");
  });
  test("keeps deleted files distinct from same-named directories and prunes orphans", () => {
    const model = modelFor(
      ["a", "a/b/c.ts", "other"],
      defaultExpandedDirectories(["a/b/c.ts"])
    );

    expect(model.rows(0, 10).map((row) => row.node.id)).toEqual([
      "dir:a/b",
      "file:a/b/c.ts",
      "file:a",
      "file:other",
    ]);
    model.focus("file:a/b/c.ts");
    model.syncPaths(filesFor(["a", "other"]));
    expect(model.rows(0, 10).map((row) => row.node.id)).toEqual([
      "file:a",
      "file:other",
    ]);
    expect(model.focusedRow()).toBeDefined();
    model.focus("file:a");
    expect(model.focusedRow()?.node.path).toBe("a");
  });
  test("preserves unusual filenames and symlink metadata exactly", () => {
    const paths = [
      " spaced /tab\tname\n.ts",
      "back\\slash",
      "雪/é.ts",
      "dir:literal",
      "file:literal",
      "a\r.ts",
    ];

    const model = modelFor(paths, defaultExpandedDirectories(paths));
    model.syncPaths(
      new Map(
        paths.map((path) => [path, { path, symlink: true, tracked: false }])
      )
    );
    expect(
      model
        .rows(0, 20)
        .values()
        .filter((row) => row.node.type === "file")
        .map((row) => row.node.path)
        .toArray()
        .toSorted()
    ).toEqual(paths.toSorted());

    for (const path of paths) {
      model.focus(`file:${path}`);
      expect(model.focusedRow()?.node).toMatchObject({
        path,
        symlink: true,
        tracked: false,
      });
    }
  });
  test("updates counts, stages, and warnings without disturbing focus or expansion", () => {
    const paths = ["src/a.ts", "src/b.ts", "src/nested/c.ts"];
    const model = modelFor(paths, new Set(["dir:src"]));
    model.focus("file:src/b.ts");
    model.setChanges(
      new Map([
        [
          "src/a.ts",
          changed("src/a.ts", {
            additions: 10,
            stage: "staged",
            warnings: ["new"],
          }),
        ],
        [
          "src/b.ts",
          changed("src/b.ts", {
            additions: 3,
            deletions: 1,
            warnings: ["new", "large"],
          }),
        ],
      ])
    );
    expect(model.rows(0, 1)[0].node).toMatchObject({
      additions: 13,
      deletions: 1,
      fileCount: 3,
      changedCount: 2,
      stage: "mixed",
      warnings: ["new", "large"],
    });
    expect(model.focusedRow()?.node.path).toBe("src/b.ts");
    expect(model.rows(0, 20).map((row) => row.node.path)).not.toContain(
      "src/nested/c.ts"
    );
    model.setChanges(new Map());
    expect(model.rows(0, 1)[0].node).toMatchObject({
      additions: 0,
      deletions: 0,
      changedCount: 0,
      stage: undefined,
      warnings: [],
    });
  });
  test("retains expansion through additions, filtering, and deferred loading", () => {
    const expansion = defaultExpandedDirectories(["src/nested/a", "other/b"]);
    const model = modelFor([], expansion);
    model.syncPaths(filesFor(["src/nested/a", "other/b"]));
    expect(model.rows(0, 20).map((row) => row.node.path)).toContain(
      "src/nested/a"
    );
    model.syncPaths(filesFor(["other/b"]));
    model.syncPaths(filesFor(["src/nested/a", "src/new", "other/b"]));
    expect(model.rows(0, 20).map((row) => row.node.path)).toContain(
      "src/nested/a"
    );
    model.setExpanded(new Set());
    model.syncPaths(
      filesFor(["src/nested/a", "src/new", "other/b", "other/c"])
    );
    expect(model.rows(0, 20).map((row) => row.node.path)).toEqual([
      "other",
      "src",
    ]);
  });
  test("notifies subscribers and lets owners unsubscribe before cleanup", () => {
    const model = modelFor(["a", "b"]);
    let notifications = 0;

    const unsubscribe = model.subscribe(() => {
      notifications += 1;
    });

    model.focus("file:b");
    expect(notifications).toBeGreaterThan(0);
    unsubscribe();
    const before = notifications;
    model.focus("file:a");
    expect(notifications).toBe(before);
  });
  test("reads bounded windows on 10,000 files through repeated updates", () => {
    const paths = Array.from(
      { length: 10_000 },
      (_, i) => `dir${Math.floor(i / 100)}/file${i}.ts`
    );

    const model = modelFor(paths, defaultExpandedDirectories(paths));
    expect(model.rowCount()).toBe(10_100);
    model.focus("file:dir99/file9999.ts");

    for (let i = 0; i < 10; i += 1) {
      model.setChanges(
        new Map([[paths[0], changed(paths[0], { additions: i })]])
      );
      expect(model.rows(5000, 40)).toHaveLength(40);
      expect(model.focusedRow()?.node.path).toBe("dir99/file9999.ts");
    }
  });
});

test("directory controls expose Trees' live expansion and retain it through refreshes", () => {
  const model = modelFor(["src/deep/a", "src/b"]);
  expect(model.rows(0, 1)[0].node).toMatchObject({ expanded: false });
  model.move("right");
  expect(model.rows(0, 1)[0].node).toMatchObject({ expanded: true });
  model.toggle("dir:src");
  expect(model.rows(0, 1)[0].node).toMatchObject({ expanded: false });
  model.syncPaths(filesFor(["src/deep/a", "src/b", "src/c"]));
  expect(model.rowCount()).toBe(1);
  model.move("right");
  model.move("left");
  expect(model.rowCount()).toBe(1);
  expect(model.activate()).toBeNull();
  expect(model.rows(0, 1)[0].node).toMatchObject({ expanded: true });
  model.move("right");
  expect(model.focusedRow()?.node.path).toBe("src/deep");
  model.move("right");
  model.move("right");
  expect(model.activate()).toBe("src/deep/a");
});

test("initial expansion with natural numeric ordering opens only the requested path", () => {
  const model = modelFor(
    ["dir2/a", "dir20/b", "dir9/c"],
    new Set(["dir:dir2"])
  );

  expect(model.rows(0, 20).map((row) => row.node.path)).toEqual([
    "dir2",
    "dir2/a",
    "dir9",
    "dir20",
  ]);
});

test("incremental replacements preserve directory counts and activation order", () => {
  const model = modelFor(["a", "a/old/file", "a/z"], new Set(["dir:a"]));
  model.syncPaths(filesFor(["a", "a/new/file", "a/y", "a/z"]));
  expect(model.rows(0, 1)[0].node).toMatchObject({
    path: "a",
    fileCount: 3,
    expanded: true,
  });
  expect(model.rows(0, 20).map((row) => row.node.path)).not.toContain("a/old");
  model.move("right");
  model.move("right");
  model.move("right");
  expect(model.activate()).toBe("a/new/file");
  model.syncPaths(filesFor([]));
  expect(model.activate()).toBeNull();
});

test("left collapses an open folder, otherwise focuses its parent", () => {
  const model = modelFor(["src/deep/a", "src/b"]);
  model.reveal("src/deep/a");
  model.move("left");
  expect(model.focusedRow()?.node).toMatchObject({
    path: "src/deep",
    expanded: true,
  });
  model.move("left");
  expect(model.focusedRow()?.node).toMatchObject({
    path: "src/deep",
    expanded: false,
  });
  model.move("left");
  expect(model.focusedRow()?.node.path).toBe("src");
  model.move("left");
  expect(model.rowCount()).toBe(1);
});

test("right advances from a file and first/last focus the visible endpoints", () => {
  const model = modelFor(["a", "b", "c"]);
  model.move("right");
  expect(model.focusedRow()?.node.path).toBe("b");
  model.move("last");
  expect(model.focusedRow()?.node.path).toBe("c");
  model.move("first");
  expect(model.focusedRow()?.node.path).toBe("a");
});
