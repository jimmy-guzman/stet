import { describe, expect, test } from "bun:test";

import { buildCommandMenuItems } from "@/components/command-menu/items";
import type { CommandMenuInput } from "@/components/command-menu/items";

const viewer = (
  overrides: Partial<CommandMenuInput> = {}
): CommandMenuInput => ({
  caretLine: 12,
  context: "viewer",
  reference: { endLine: undefined, line: 12 },
  selectedPath: "src/foo.ts",
  selecting: false,
  treeNode: undefined,
  truncated: false,
  ...overrides,
});

const tree = (overrides: Partial<CommandMenuInput> = {}): CommandMenuInput => ({
  caretLine: undefined,
  context: "tree",
  reference: { endLine: undefined, line: undefined },
  selectedPath: undefined,
  selecting: false,
  treeNode: { id: "file:src/foo.ts", kind: "file", path: "src/foo.ts" },
  truncated: false,
  ...overrides,
});

const labels = (input: CommandMenuInput) =>
  buildCommandMenuItems(input).map((item) => item.label);

describe("buildCommandMenuItems", () => {
  test("viewer lists the copy and open actions", () => {
    expect(labels(viewer())).toEqual([
      "Copy reference",
      "Copy file contents",
      "Open in editor",
      "Open in IDE",
      "Open externally",
    ]);
  });

  test("viewer shows full content only when the file is truncated", () => {
    expect(labels(viewer({ truncated: false }))).not.toContain(
      "Show full content"
    );
    expect(labels(viewer({ truncated: true })).at(-1)).toBe(
      "Show full content"
    );
  });

  test("viewer copy reference carries the caret line", () => {
    const item = buildCommandMenuItems(viewer()).find(
      (entry) => entry.label === "Copy reference"
    );

    expect(item?.action).toEqual({
      endLine: undefined,
      kind: "copyReference",
      line: 12,
      path: "src/foo.ts",
    });
  });

  test("viewer with a selection copies it, and its lines as the reference", () => {
    const items = buildCommandMenuItems(
      viewer({ reference: { endLine: 18, line: 12 }, selecting: true })
    );

    expect(items[0]).toEqual({
      action: { kind: "copySelection" },
      label: "Copy selection",
    });
    expect(items[1]?.action).toEqual({
      endLine: 18,
      kind: "copyReference",
      line: 12,
      path: "src/foo.ts",
    });
  });

  test("viewer editor actions target the file at the caret line", () => {
    const items = buildCommandMenuItems(viewer());

    expect(
      items.find((item) => item.label === "Open in editor")?.action
    ).toEqual({
      kind: "openEditor",
      line: 12,
      mode: "terminal",
      path: "src/foo.ts",
    });
    expect(items.find((item) => item.label === "Open in IDE")?.action).toEqual({
      kind: "openEditor",
      line: 12,
      mode: "ide",
      path: "src/foo.ts",
    });
  });

  test("viewer without a selected path has no items", () => {
    expect(buildCommandMenuItems(viewer({ selectedPath: undefined }))).toEqual(
      []
    );
  });

  test("tree file node offers copy path and external opens", () => {
    expect(labels(tree())).toEqual([
      "Copy path",
      "Open in editor",
      "Open in IDE",
      "Open externally",
    ]);
  });

  test("open externally carries the path", () => {
    expect(
      buildCommandMenuItems(viewer()).find(
        (item) => item.label === "Open externally"
      )?.action
    ).toEqual({ kind: "openExternal", path: "src/foo.ts" });
    expect(
      buildCommandMenuItems(tree()).find(
        (item) => item.label === "Open externally"
      )?.action
    ).toEqual({ kind: "openExternal", path: "src/foo.ts" });
  });

  test("tree file copy path and editor opens carry the node path with no line", () => {
    const items = buildCommandMenuItems(tree());

    expect(items.find((item) => item.label === "Copy path")?.action).toEqual({
      kind: "copyReference",
      line: undefined,
      path: "src/foo.ts",
    });
    expect(
      items.find((item) => item.label === "Open in editor")?.action
    ).toEqual({
      kind: "openEditor",
      line: undefined,
      mode: "terminal",
      path: "src/foo.ts",
    });
  });

  test("tree directory node offers only its path (no expand/collapse)", () => {
    const node = { id: "dir:src", kind: "directory" as const, path: "src" };

    expect(labels(tree({ treeNode: node }))).toEqual(["Copy path"]);
    expect(buildCommandMenuItems(tree({ treeNode: node }))[0]?.action).toEqual({
      kind: "copyReference",
      line: undefined,
      path: "src",
    });
  });

  test("tree without a focused node has no items", () => {
    expect(buildCommandMenuItems(tree({ treeNode: undefined }))).toEqual([]);
  });
});
