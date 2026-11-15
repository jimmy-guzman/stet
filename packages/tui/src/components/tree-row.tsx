import type { MouseEvent } from "@opentui/core";
import { batch, Show } from "solid-js";

import { namedIcon } from "@/file-support/registry";
import type { DirectoryNode, FileNode, FileTreeRow } from "@/git/tree";
import { state } from "@/state";
import { theme } from "@/theme/context";
import { kindLetter } from "@/ui-helpers";
import { truncate, truncateName } from "@/utils/text";

import { FileIcon } from "./file-icon";
import { isRightClick } from "./mouse";
import { RecencyDot } from "./recency-dot";

// Fine-grained reactivity replaces React.memo: only the rows whose focus,
// Selection, or change state actually change re-evaluate. Under the sidebar's
// Windowed <Index> a slot's row changes identity on every scroll step, and can
// Flip between file and directory, so every read goes through props (never a
// Setup-time capture) and the type branch is a reactive <Show> pair. The
// Double-click guard is owned by the Sidebar and shared across rows, so it
// Survives a row remount mid-gesture and never leaks process-wide.
const asDirectoryNode = (row: FileTreeRow) =>
  row.node.type === "directory" ? row.node : undefined;

const asFileNode = (row: FileTreeRow) =>
  row.node.type === "file" ? row.node : undefined;

export const TreeRow = (props: {
  row: FileTreeRow;
  isDoubleClick: (id: string) => boolean;
}) => (
  <>
    <Show when={asDirectoryNode(props.row)}>
      {(node) => (
        <DirectoryRow
          node={node()}
          row={props.row}
          isDoubleClick={props.isDoubleClick}
        />
      )}
    </Show>
    <Show when={asFileNode(props.row)}>
      {(node) => (
        <FileRow
          node={node()}
          row={props.row}
          isDoubleClick={props.isDoubleClick}
        />
      )}
    </Show>
  </>
);

const contentWidth = () => state.layout().sidebar.content.width - 3;

const DirectoryRow = (props: {
  node: DirectoryNode;
  row: FileTreeRow;
  isDoubleClick: (id: string) => boolean;
}) => {
  const indent = () => " ".repeat(Math.max(0, props.row.depth) * 2);

  const focused = () =>
    state.focusedPane() === "tree" &&
    props.row.index === state.focusedRowIndex();

  const background = () =>
    focused() ? theme.colors.surface.cursor : theme.colors.surface.base;

  // Clicking a directory row reproduces the keyboard outcome: move the cursor
  // There and toggle its expansion (collapsing `l`/`h` into one click).
  // StopPropagation keeps the Sidebar's focus-only handler from also firing. A
  // Right-click instead focuses the row and opens the context menu at the cell.
  const onMouseDown = (event: MouseEvent) => {
    event.stopPropagation();

    if (isRightClick(event)) {
      batch(() => {
        state.setFocusedPane("tree");
        state.focusTreeNode(props.node.id);
      });
      state.openCommandMenu("tree", { x: event.x, y: event.y });

      return;
    }

    batch(() => {
      state.setFocusedPane("tree");
      state.focusTreeNode(props.node.id);
      // Advance the shared double-click tracker (its result is unused here, a directory
      // Has no double-click action), so a directory click between two clicks on the same
      // File registers as a distinct row and breaks the sequence, rather than being
      // Invisible to the tracker and letting the second file click read as a double-pin.
      props.isDoubleClick(props.node.id);
      state.toggleTreeNode(props.node.id);
    });
  };

  const isExpanded = () => props.node.expanded;
  const icon = () => namedIcon(isExpanded() ? "folder-open" : "folder");

  // The directory dot tracks its most recently changed descendant; the dot itself
  // Decides freshness from the timestamp, so an aged-out value simply yields no dot.
  const recencyAt = () =>
    isExpanded()
      ? undefined
      : state.directoryRecencyByPath().get(props.node.path);

  const nameFg = () => {
    if (focused()) {
      return theme.colors.text.selected;
    }

    return props.node.changedCount > 0
      ? theme.colors.text.primary
      : theme.colors.text.strong;
  };

  const glyph = () => {
    if (state.iconsEnabled()) {
      return icon().glyph;
    }

    return isExpanded() ? "▾" : "▸";
  };

  const hasBadges = () => !isExpanded() && props.node.changedCount > 0;

  const maxNameLen = () =>
    contentWidth() - indent().length - 2 - (hasBadges() ? 14 : 0);

  return (
    <box
      width="100%"
      height={1}
      overflow="hidden"
      flexDirection="row"
      justifyContent="space-between"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={background()}
      onMouseDown={onMouseDown}
    >
      <box flexDirection="row">
        <box flexDirection="row" flexShrink={0}>
          <text wrapMode="none" height={1} fg={nameFg()}>
            {indent()}
          </text>
          <box width={2} overflow="hidden">
            <text
              wrapMode="none"
              height={1}
              fg={
                state.iconsEnabled()
                  ? (theme.colors.icon[icon().name] ?? theme.colors.text.muted)
                  : nameFg()
              }
            >
              {glyph()}
            </text>
          </box>
        </box>
        <text wrapMode="none" height={1} fg={nameFg()}>
          {truncateName(props.node.name, maxNameLen())}
        </text>
        <RecencyDot at={recencyAt()} marginLeft={1} />
      </box>
      <box flexDirection="row">
        {props.node.changedCount > 0 ? (
          <text
            wrapMode="none"
            height={1}
            fg={
              props.node.stage === undefined
                ? theme.colors.text.muted
                : theme.colors.stage[props.node.stage]
            }
          >
            {`+${props.node.additions} -${props.node.deletions}`}
          </text>
        ) : null}
      </box>
    </box>
  );
};

const FileRow = (props: {
  node: FileNode;
  row: FileTreeRow;
  isDoubleClick: (id: string) => boolean;
}) => {
  const indent = () => " ".repeat(Math.max(0, props.row.depth) * 2);

  const focused = () =>
    state.focusedPane() === "tree" &&
    props.row.index === state.focusedRowIndex();

  const background = () =>
    focused() ? theme.colors.surface.cursor : theme.colors.surface.base;

  // Clicking a file row reproduces the keyboard outcome: select and open (like
  // `enter`), and double-clicking pins it as a tab. stopPropagation keeps the
  // Sidebar's focus-only handler from also firing. A right-click instead focuses
  // The row (without opening it) and opens the context menu at the cell.
  const onMouseDown = (event: MouseEvent) => {
    event.stopPropagation();

    if (isRightClick(event)) {
      batch(() => {
        state.setFocusedPane("tree");
        state.focusTreeNode(props.node.id);
      });
      state.openCommandMenu("tree", { x: event.x, y: event.y });

      return;
    }

    batch(() => {
      state.setFocusedPane("tree");
      state.selectFile(props.node.path);

      if (props.isDoubleClick(props.node.path)) {
        state.pinActiveTab();
      }
    });
  };

  const changed = () => props.node.changed;
  const selected = () => state.selectedPath() === props.node.path;

  const nameFg = () => {
    if (focused() || selected()) {
      return theme.colors.text.selected;
    }

    const file = changed();

    return file === undefined
      ? theme.colors.text.secondary
      : theme.colors.kind[file.kind];
  };

  const hasBadges = () => changed() !== undefined;

  const maxNameLen = () =>
    contentWidth() -
    indent().length -
    (state.iconsEnabled() ? 2 : 0) -
    (hasBadges() ? 14 : 0);

  return (
    <box
      width="100%"
      height={1}
      overflow="hidden"
      flexDirection="row"
      justifyContent="space-between"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={background()}
      onMouseDown={onMouseDown}
    >
      <box flexDirection="row">
        <box flexDirection="row" flexShrink={0}>
          <text wrapMode="none" height={1} fg={theme.colors.text.muted}>
            {indent()}
          </text>
          <FileIcon path={props.node.path} symlink={props.node.symlink} />
        </box>
        <text wrapMode="none" height={1} fg={nameFg()}>
          {truncate(props.node.name, maxNameLen())}
        </text>
        <RecencyDot
          at={state.recencyByPath().get(props.node.path)}
          marginLeft={1}
        />
      </box>
      <box flexDirection="row">
        {(changed()?.warnings.length ?? 0) > 0 ? (
          <text wrapMode="none" height={1} fg={theme.colors.severity.warning}>
            !{" "}
          </text>
        ) : null}
        <Show when={changed()}>
          {(file) => (
            <text
              wrapMode="none"
              height={1}
              fg={theme.colors.text.muted}
            >{`+${file().additions} -${file().deletions} `}</text>
          )}
        </Show>
        <Show when={changed()}>
          {(file) => (
            <text
              wrapMode="none"
              height={1}
              fg={theme.colors.stage[file().stage]}
            >
              {kindLetter(file().kind)}
            </text>
          )}
        </Show>
      </box>
    </box>
  );
};
