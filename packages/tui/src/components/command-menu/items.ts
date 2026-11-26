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

/**
 * Where a menu opens: on the viewer's caret, or on one file or directory named by the tree, a search
 * result, or a viewed file the viewer cannot show as text (a binary preview or a placeholder).
 */
export type CommandMenuContext = "tree" | "viewer" | "search" | "preview";

export interface CommandMenuInput {
  context: CommandMenuContext;
  /** The viewed file; the viewer menu is empty without one. */
  selectedPath: string | undefined;
  /** The caret line (`newLine ?? oldLine`), where the editor opens. */
  caretLine: number | undefined;
  /** The lines a copied reference names: the selection's, else the caret line. */
  reference: { line: number | undefined; endLine: number | undefined };
  /** Whether text is selected in the viewer, gating "Copy selection". */
  selecting: boolean;
  /**
   * What a tree, search, or preview menu acts on: the focused node, the selected result (a match
   * carries its line), or the viewed file. Every context but the viewer's is empty without one.
   */
  target:
    | { kind: "file" | "directory"; path: string; line?: number }
    | undefined;
  /** Whether the viewer capped the file, gating the "Show full content" action. */
  truncated: boolean;
}

export const buildCommandMenuItems = (
  input: CommandMenuInput
): CommandMenuItem[] =>
  input.context === "viewer" ? viewerItems(input) : targetItems(input);

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

const targetItems = (input: CommandMenuInput): CommandMenuItem[] => {
  const node = input.target;

  if (node === undefined) {
    return [];
  }

  const copy: CommandMenuItem = {
    action: { kind: "copyReference", line: node.line, path: node.path },
    label: node.line === undefined ? "Copy path" : "Copy reference",
  };

  if (node.kind === "directory") {
    return [copy];
  }

  return [
    copy,
    {
      action: {
        kind: "openEditor",
        line: node.line,
        mode: "terminal",
        path: node.path,
      },
      label: "Open in editor",
    },
    {
      action: {
        kind: "openEditor",
        line: node.line,
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
