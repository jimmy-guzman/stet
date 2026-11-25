// The context menu's item list, kept a pure function of plain inputs (no Solid/
// Effect/OpenTUI) so the per-context contents are unit-tested directly, the way
// `viewer/anchor.ts` is. `state.commandMenuItems` wraps this over the live caret and
// Tree signals; the keymap and the row click both dispatch a returned `action`, so
// The menu introduces no new behavior. Inapplicable actions are omitted, not shown
// Disabled, so every visible item is always actionable.

/**
 * A menu item's effect: every variant maps to an existing `state` action (or, for `openEditor`, the
 * injected host effect).
 */
export type CommandAction =
  | {
      kind: "copyReference";
      path: string;
      line: number | undefined;
      endLine?: number;
    }
  | { kind: "copySelection" }
  | { kind: "copyFileContents" }
  | { kind: "loadFullContent" }
  | {
      kind: "openEditor";
      mode: "terminal" | "ide";
      path: string;
      line: number | undefined;
    }
  | { kind: "openExternal"; path: string };

export interface CommandMenuItem {
  label: string;
  action: CommandAction;
}

export interface CommandMenuInput {
  context: "tree" | "viewer";
  /** The viewed file; the viewer menu is empty without one. */
  selectedPath: string | undefined;
  /** The caret line (`newLine ?? oldLine`), where the editor opens. */
  caretLine: number | undefined;
  /** The lines a copied reference names: the selection's, else the caret line. */
  reference: { line: number | undefined; endLine: number | undefined };
  /** Whether text is selected in the viewer, gating "Copy selection". */
  selecting: boolean;
  /** The focused tree node; the tree menu is empty without one. */
  treeNode:
    | { kind: "file" | "directory"; id: string; path: string }
    | undefined;
  /** Whether the viewer capped the file, gating the "Show full content" action. */
  truncated: boolean;
}

export const buildCommandMenuItems = (
  input: CommandMenuInput
): CommandMenuItem[] =>
  input.context === "viewer" ? viewerItems(input) : treeItems(input);

const viewerItems = (input: CommandMenuInput): CommandMenuItem[] => {
  const path = input.selectedPath;

  if (path === undefined) {
    return [];
  }

  return [
    ...(input.selecting
      ? [
          {
            action: { kind: "copySelection" },
            label: "Copy selection",
          } as const,
        ]
      : []),
    {
      action: { kind: "copyReference", path, ...input.reference },
      label: "Copy reference",
    },
    { action: { kind: "copyFileContents" }, label: "Copy file contents" },
    {
      action: {
        kind: "openEditor",
        line: input.caretLine,
        mode: "terminal",
        path,
      },
      label: "Open in editor",
    },
    {
      action: { kind: "openEditor", line: input.caretLine, mode: "ide", path },
      label: "Open in IDE",
    },
    { action: { kind: "openExternal", path }, label: "Open externally" },
    // Only when the viewer actually capped the file; otherwise it would be a no-op.
    ...(input.truncated
      ? [
          {
            action: { kind: "loadFullContent" },
            label: "Show full content",
          } as const,
        ]
      : []),
  ];
};

const treeItems = (input: CommandMenuInput): CommandMenuItem[] => {
  const node = input.treeNode;

  if (node === undefined) {
    return [];
  }

  const copyPath: CommandMenuItem = {
    action: {
      kind: "copyReference",
      line: undefined,
      path: node.path,
    },
    label: "Copy path",
  };

  if (node.kind === "directory") {
    return [copyPath];
  }

  return [
    copyPath,
    {
      action: {
        kind: "openEditor",
        line: undefined,
        mode: "terminal",
        path: node.path,
      },
      label: "Open in editor",
    },
    {
      action: {
        kind: "openEditor",
        line: undefined,
        mode: "ide",
        path: node.path,
      },
      label: "Open in IDE",
    },
    {
      action: { kind: "openExternal", path: node.path },
      label: "Open externally",
    },
  ];
};
