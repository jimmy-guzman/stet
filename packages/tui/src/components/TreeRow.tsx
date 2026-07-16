import type { MouseEvent } from "@opentui/core";
import { batch, createMemo, Show } from "solid-js";

import { checkerSummary, emptyDirectorySummary } from "@/diagnostics/checker";
import type { DirectoryNode, FileNode, FileTreeRow } from "@/git/tree";
import { levelGlyph } from "@/log/levels";
import { state } from "@/state";
import { useTheme } from "@/theme/context";
import { kindLetter } from "@/ui-helpers";
import { folderIconModel } from "@/utils/file-icon";
import { truncate, truncateName } from "@/utils/text";

import { FileIcon } from "./FileIcon";
import { isRightClick } from "./mouse";
import { RecencyDot } from "./RecencyDot";

// Fine-grained reactivity replaces React.memo: only the rows whose focus,
// Selection, or checker state actually change re-evaluate. Under the sidebar's
// Windowed <Index> a slot's row changes identity on every scroll step, and can
// Flip between file and directory, so every read goes through props (never a
// Setup-time capture) and the type branch is a reactive <Show> pair. The
// Double-click guard is owned by the Sidebar and shared across rows, so it
// Survives a row remount mid-gesture and never leaks process-wide.
const asDirectoryNode = (row: FileTreeRow) =>
  row.node.type === "directory" ? row.node : undefined;
const asFileNode = (row: FileTreeRow) => (row.node.type === "file" ? row.node : undefined);

export function TreeRow(props: { row: FileTreeRow; isDoubleClick: (id: string) => boolean }) {
  return (
    <>
      <Show when={asDirectoryNode(props.row)}>
        {(node) => <DirectoryRow node={node()} row={props.row} />}
      </Show>
      <Show when={asFileNode(props.row)}>
        {(node) => <FileRow node={node()} row={props.row} isDoubleClick={props.isDoubleClick} />}
      </Show>
    </>
  );
}

function DirectoryRow(props: { node: DirectoryNode; row: FileTreeRow }) {
  const theme = useTheme();
  const indent = () => " ".repeat(Math.max(0, props.row.depth) * 2);
  const focused = () =>
    state.focusedPane() === "tree" && props.row.index === state.focusedRowIndex();
  const background = () => (focused() ? theme.colors.surface.cursor : theme.colors.surface.base);
  const contentWidth = () => state.sidebarWidth() - 5;

  // Clicking a directory row reproduces the keyboard outcome: move the cursor
  // There and toggle its expansion (collapsing `l`/`h` into one click).
  // StopPropagation keeps the Sidebar's focus-only handler from also firing. A
  // Right-click instead focuses the row and opens the context menu at the cell.
  const onMouseDown = (event: MouseEvent) => {
    event.stopPropagation();
    if (isRightClick(event)) {
      batch(() => {
        state.setFocusedPane("tree");
        state.setFocusedNodeId(props.node.id);
      });
      state.openCommandMenu("tree", { x: event.x, y: event.y });
      return;
    }
    batch(() => {
      state.setFocusedPane("tree");
      state.setFocusedNodeId(props.node.id);
      const next = new Set(state.expandedDirectories());
      if (next.has(props.node.id)) {
        next.delete(props.node.id);
      } else {
        next.add(props.node.id);
      }
      state.setExpandedDirectories(next);
    });
  };

  const isExpanded = () => state.expandedDirectories().has(props.node.id);
  const icon = () => folderIconModel(isExpanded());
  // The directory dot tracks its most recently changed descendant; the dot itself
  // Decides freshness from the timestamp, so an aged-out value simply yields no dot.
  const recencyAt = () =>
    isExpanded() ? undefined : state.directoryRecencyByPath().get(props.node.path);
  const summary = createMemo(() =>
    isExpanded()
      ? null
      : (state.directorySummariesByPath().get(props.node.path) ?? emptyDirectorySummary),
  );
  const nameFg = () =>
    focused()
      ? theme.colors.text.selected
      : props.node.changedCount > 0
        ? theme.colors.text.primary
        : theme.colors.text.strong;
  const hasBadges = () => {
    const s = summary();
    return (
      !isExpanded() &&
      (props.node.changedCount > 0 ||
        Boolean(s?.failed) ||
        Boolean(s?.pending) ||
        Boolean(s?.unavailable) ||
        (s?.errors ?? 0) > 0 ||
        (s?.warnings ?? 0) > 0 ||
        (s?.info ?? 0) > 0)
    );
  };
  const maxNameLen = () => contentWidth() - indent().length - 2 - (hasBadges() ? 14 : 0);
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
              {state.iconsEnabled() ? icon().glyph : isExpanded() ? "▾" : "▸"}
            </text>
          </box>
        </box>
        <text wrapMode="none" height={1} fg={nameFg()}>
          {truncateName(props.node.name, maxNameLen())}
        </text>
        <RecencyDot at={recencyAt()} marginLeft={1} />
      </box>
      <box flexDirection="row">
        {summary()?.failed ? (
          <text wrapMode="none" height={1} fg={theme.colors.severity.error}>
            ⊗{" "}
          </text>
        ) : null}
        {(summary()?.errors ?? 0) > 0 ? (
          <text
            wrapMode="none"
            height={1}
            fg={theme.colors.severity.error}
          >{`${levelGlyph("error")}${summary()?.errors} `}</text>
        ) : null}
        {summary() !== null && summary()?.errors === 0 && (summary()?.warnings ?? 0) > 0 ? (
          <text
            wrapMode="none"
            height={1}
            fg={theme.colors.severity.warning}
          >{`${levelGlyph("warning")}${summary()?.warnings} `}</text>
        ) : null}
        {summary()?.errors === 0 && summary()?.warnings === 0 && (summary()?.info ?? 0) > 0 ? (
          <text
            wrapMode="none"
            height={1}
            fg={theme.colors.severity.info}
          >{`${levelGlyph("info")}${summary()?.info} `}</text>
        ) : null}
        {summary()?.pending ? (
          <text wrapMode="none" height={1} fg={theme.colors.text.muted}>
            …{" "}
          </text>
        ) : null}
        {summary() !== null &&
        props.node.changedCount > 0 &&
        !summary()?.failed &&
        !summary()?.pending &&
        !summary()?.unavailable &&
        summary()?.errors === 0 &&
        summary()?.warnings === 0 &&
        (summary()?.info ?? 0) === 0 ? (
          <text
            wrapMode="none"
            height={1}
            fg={theme.colors.success}
          >{`${levelGlyph("success")} `}</text>
        ) : null}
        {summary()?.unavailable &&
        !summary()?.failed &&
        !summary()?.pending &&
        (summary()?.errors ?? 0) === 0 &&
        (summary()?.warnings ?? 0) === 0 ? (
          <text wrapMode="none" height={1} fg={theme.colors.text.muted}>
            ○{" "}
          </text>
        ) : null}
        {props.node.changedCount > 0 ? (
          <text
            wrapMode="none"
            height={1}
            fg={
              props.node.stage !== undefined
                ? theme.colors.stage[props.node.stage]
                : theme.colors.text.muted
            }
          >
            {`+${props.node.additions} -${props.node.deletions}`}
          </text>
        ) : null}
      </box>
    </box>
  );
}

function FileRow(props: {
  node: FileNode;
  row: FileTreeRow;
  isDoubleClick: (id: string) => boolean;
}) {
  const theme = useTheme();
  const indent = () => " ".repeat(Math.max(0, props.row.depth) * 2);
  const focused = () =>
    state.focusedPane() === "tree" && props.row.index === state.focusedRowIndex();
  const background = () => (focused() ? theme.colors.surface.cursor : theme.colors.surface.base);
  const contentWidth = () => state.sidebarWidth() - 5;

  // Clicking a file row reproduces the keyboard outcome: select and open (like
  // `enter`), and double-clicking pins it as a tab. stopPropagation keeps the
  // Sidebar's focus-only handler from also firing. A right-click instead focuses
  // The row (without opening it) and opens the context menu at the cell.
  const onMouseDown = (event: MouseEvent) => {
    event.stopPropagation();
    if (isRightClick(event)) {
      batch(() => {
        state.setFocusedPane("tree");
        state.setFocusedNodeId(props.node.id);
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
  const summary = createMemo(() => checkerSummary(props.node.path, state.checkerState()));
  const selected = () => state.selectedPath() === props.node.path;
  const nameFg = () => {
    if (focused() || selected()) {
      return theme.colors.text.selected;
    }
    const file = changed();
    return file === undefined ? theme.colors.text.secondary : theme.colors.kind[file.kind];
  };
  const pending = () => changed() !== undefined && summary().pending;
  const hasBadges = () => {
    const s = summary();
    return (
      changed() !== undefined ||
      s.failed ||
      s.errors > 0 ||
      s.warnings > 0 ||
      s.info > 0 ||
      s.pending
    );
  };
  const maxNameLen = () =>
    contentWidth() - indent().length - (state.iconsEnabled() ? 2 : 0) - (hasBadges() ? 14 : 0);

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
        <RecencyDot at={state.recencyByPath().get(props.node.path)} marginLeft={1} />
      </box>
      <box flexDirection="row">
        {summary().failed ? (
          <text wrapMode="none" height={1} fg={theme.colors.severity.error}>
            ⊗{" "}
          </text>
        ) : null}
        {summary().errors > 0 ? (
          <text
            wrapMode="none"
            height={1}
            fg={theme.colors.severity.error}
          >{`${levelGlyph("error")}${summary().errors} `}</text>
        ) : null}
        {summary().errors === 0 && summary().warnings > 0 ? (
          <text
            wrapMode="none"
            height={1}
            fg={theme.colors.severity.warning}
          >{`${levelGlyph("warning")}${summary().warnings} `}</text>
        ) : null}
        {summary().errors === 0 && summary().warnings === 0 && summary().info > 0 ? (
          <text
            wrapMode="none"
            height={1}
            fg={theme.colors.severity.info}
          >{`${levelGlyph("info")}${summary().info} `}</text>
        ) : null}
        {(changed()?.warnings.length ?? 0) > 0 ? (
          <text wrapMode="none" height={1} fg={theme.colors.severity.warning}>
            !{" "}
          </text>
        ) : null}
        {changed() !== undefined &&
        !pending() &&
        !summary().failed &&
        !summary().unavailable &&
        summary().errors === 0 &&
        summary().warnings === 0 &&
        summary().info === 0 ? (
          <text
            wrapMode="none"
            height={1}
            fg={theme.colors.success}
          >{`${levelGlyph("success")} `}</text>
        ) : null}
        {changed() !== undefined &&
        !pending() &&
        !summary().failed &&
        summary().unavailable &&
        summary().errors === 0 &&
        summary().warnings === 0 ? (
          <text wrapMode="none" height={1} fg={theme.colors.text.muted}>
            ○{" "}
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
        {pending() ? (
          <text wrapMode="none" height={1} fg={theme.colors.text.muted}>
            …{" "}
          </text>
        ) : null}
        <Show when={changed()}>
          {(file) => (
            <text wrapMode="none" height={1} fg={theme.colors.stage[file().stage]}>
              {kindLetter(file().kind)}
            </text>
          )}
        </Show>
      </box>
    </box>
  );
}
