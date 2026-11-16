import { FileTree } from "@pierre/trees";
import type { FileTreeBatchOperation } from "@pierre/trees";

import type { ChangedFile, RepoFile, StageState } from "@/git/model";
import { expandAncestorsForPath } from "@/git/tree";
import type { FileNode, FileTreeRow } from "@/git/tree";

// Git forbids NUL, so files can coexist with same-named directories across diff endpoints.
const encodeFile = (path: string) => `${path}\0`;
const decode = (path: string) => path.slice(0, -1);

const encodeId = (id: string) =>
  id.startsWith("dir:") ? `${id.slice(4)}/` : encodeFile(id.slice(5));

export type TreeMove =
  | "next"
  | "previous"
  | "right"
  | "left"
  | "first"
  | "last";

const ancestors = (path: string) => {
  const parts = path.split("/");

  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
};

/** Owns model identities; every row and action outside this module uses original Git paths. */
export const createTreeModel = () => {
  const tree = new FileTree({
    flattenEmptyDirectories: true,
    initialExpansion: "closed",
    paths: [],
  });

  let files = new Map<string, RepoFile>();
  let directories = new Map<string, number>();
  let changes = new Map<string, ChangedFile>();

  let decorations = new Map<
    string,
    {
      additions: number;
      deletions: number;
      changedCount: number;
      stages: Set<StageState>;
      warnings: Set<string>;
    }
  >();

  let expanded = new Set<string>();
  let focusIntent = "";

  const focus = (id: string) => {
    focusIntent = id;
    tree.focusPath(encodeId(id));
  };

  const setExpanded = (next: Set<string>) => {
    for (const id of expanded.symmetricDifference(next)) {
      const item = tree.getItem(encodeId(id));

      if (item !== null && "expand" in item) {
        if (next.has(id)) {
          item.expand();
        } else {
          item.collapse();
        }
      }
    }

    expanded = new Set(next);
    tree.focusPath(encodeId(focusIntent));
  };

  const restoreExpansion = (initializing: boolean) => {
    const collapsedAncestors = new Set<string>();

    for (const id of expanded) {
      if (!initializing && directories.has(id.slice(4))) {
        continue;
      }

      if (!initializing) {
        const item = tree.getItem(encodeId(id));

        if (item !== null && "expand" in item) {
          item.expand();
        }
      }

      // Trees expands ancestors too, even when restoring a hidden child's intent.
      for (const parent of ancestors(id.slice(4))) {
        if (!expanded.has(`dir:${parent}`)) {
          collapsedAncestors.add(parent);
        }
      }
    }

    for (const path of collapsedAncestors) {
      const item = tree.getItem(`${path}/`);

      if (item !== null && "collapse" in item) {
        item.collapse();
      }
    }
  };

  const syncPaths = (nextFiles: Map<string, RepoFile>) => {
    const nextDirectories = new Map(directories);
    const initializing = files.size === 0;
    const operations: FileTreeBatchOperation[] = [];

    for (const path of files.keys()) {
      if (nextFiles.has(path)) {
        continue;
      }

      operations.push({ path: encodeFile(path), type: "remove" });

      for (const parent of ancestors(path)) {
        const remaining = (nextDirectories.get(parent) ?? 0) - 1;

        if (remaining === 0) {
          nextDirectories.delete(parent);
        } else {
          nextDirectories.set(parent, remaining);
        }
      }
    }

    for (const path of nextFiles.keys()) {
      if (files.has(path)) {
        continue;
      }

      if (!initializing) {
        operations.push({ path: encodeFile(path), type: "add" });
      }

      for (const parent of ancestors(path)) {
        nextDirectories.set(parent, (nextDirectories.get(parent) ?? 0) + 1);
      }
    }

    // Trees retains empty directories; Git's file universe does not include them.
    for (const path of [...directories.keys()].toSorted(
      (a, b) => b.length - a.length
    )) {
      if (!nextDirectories.has(path)) {
        operations.push({ path: `${path}/`, type: "remove" });
      }
    }

    if (initializing) {
      tree.resetPaths([...nextFiles.keys()].map(encodeFile), {
        initialExpandedPaths: [...expanded].map(encodeId),
      });
    } else if (operations.length > 0) {
      tree.batch(operations);
    }

    restoreExpansion(initializing);

    files = nextFiles;
    directories = nextDirectories;

    tree.focusPath(encodeId(focusIntent));
  };

  const setChanges = (next: Map<string, ChangedFile>) => {
    changes = next;
    decorations = new Map();

    for (const [path, change] of next) {
      if (!files.has(path)) {
        continue;
      }

      for (const parent of ancestors(path)) {
        const decoration = decorations.get(parent) ?? {
          additions: 0,
          changedCount: 0,
          deletions: 0,
          stages: new Set<StageState>(),
          warnings: new Set<string>(),
        };

        decoration.additions += change.additions;
        decoration.deletions += change.deletions;
        decoration.changedCount += 1;
        decoration.stages.add(change.stage);

        for (const warning of change.warnings) {
          decoration.warnings.add(warning);
        }

        decorations.set(parent, decoration);
      }
    }
  };

  const fileNode = (path: string): FileNode => ({
    changed: changes.get(path),
    id: `file:${path}`,
    name: path.split("/").at(-1) ?? path,
    path,
    symlink: files.get(path)?.symlink ?? false,
    tracked: files.get(path)?.tracked ?? true,
    type: "file",
  });

  const rows = (start: number, height: number): FileTreeRow[] => {
    if (height <= 0) {
      return [];
    }

    return tree.getVisibleRows(start, start + height - 1).map((row) => {
      const path = decode(row.path);

      if (row.kind === "file") {
        return { depth: row.depth, index: row.index, node: fileNode(path) };
      }

      const directory = directories.get(path);
      const decoration = decorations.get(path);

      return {
        depth: row.depth,
        index: row.index,
        node: {
          additions: decoration?.additions ?? 0,
          changedCount: decoration?.changedCount ?? 0,
          deletions: decoration?.deletions ?? 0,
          expanded: row.isExpanded,
          fileCount: directory ?? 0,
          id: `dir:${path}`,
          name:
            row.flattenedSegments?.map((segment) => segment.name).join("/") ??
            row.name,
          path,
          stage:
            decoration !== undefined && decoration.stages.size > 1
              ? "mixed"
              : decoration?.stages.values().next().value,
          type: "directory",
          warnings: [...(decoration?.warnings ?? [])],
        },
      };
    });
  };

  const focusedIndex = () => Math.max(0, tree.getFocusedIndex());

  const toggle = (id: string) => {
    const item = tree.getItem(encodeId(id));

    if (item !== null && "toggle" in item) {
      item.toggle();

      if (item.isExpanded()) {
        expanded = expandAncestorsForPath(expanded, encodeId(id));
      } else {
        expanded.delete(id);
      }
    }
  };

  const activate = () => {
    const item = tree.getFocusedItem();

    if (item === null) {
      return null;
    }

    const path = decode(item.getPath());

    if (item.isDirectory()) {
      toggle(`dir:${path}`);

      return null;
    }

    return path;
  };

  const move = (direction: TreeMove) => {
    const item = tree.getFocusedItem();

    switch (direction) {
      case "next": {
        tree.focusNextItem();
        break;
      }

      case "previous": {
        tree.focusPreviousItem();
        break;
      }

      case "first": {
        tree.focusFirstItem();
        break;
      }

      case "last": {
        tree.focusLastItem();
        break;
      }

      case "right": {
        if (item !== null && "expand" in item && !item.isExpanded()) {
          expanded = expandAncestorsForPath(expanded, item.getPath());
          item.expand();
        } else {
          tree.focusNextItem();
        }

        break;
      }

      case "left": {
        if (item !== null && "collapse" in item && item.isExpanded()) {
          expanded.delete(`dir:${decode(item.getPath())}`);
          item.collapse();
        } else if ((rows(focusedIndex(), 1)[0]?.depth ?? 0) > 0) {
          // Trees falls back to the first row when a flattened root has no visible parent.
          tree.focusParentItem();
        }

        break;
      }

      default: {
        direction satisfies never;
      }
    }

    const focused = tree.getFocusedItem();
    focusIntent =
      focused === null
        ? ""
        : `${focused.isDirectory() ? "dir" : "file"}:${decode(focused.getPath())}`;
  };

  return {
    activate,
    cleanUp: () => {
      tree.cleanUp();
    },
    focus,
    focusedIndex,
    focusedRow: () => rows(focusedIndex(), 1)[0],
    move,
    reveal: (path: string) => {
      const next = expandAncestorsForPath(expanded, path);
      setExpanded(next);
      focus(`file:${path}`);
    },
    rowCount: () => tree.getVisibleCount(),
    rows,
    setChanges,
    setExpanded,
    subscribe: (listener: () => void) => tree.subscribe(listener),
    syncPaths,
    toggle,
  };
};
