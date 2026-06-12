import { memo } from "react"
import { recencyLevel, type RecencyLevel } from "../activity"
import { checkerSummary, directorySummary, type CheckerState } from "../diagnostics"
import { useTheme } from "../theme/context"
import type { DirectoryNode, FileTreeRow } from "../tree"
import { kindLetter, truncateName } from "../ui-helpers"

interface TreeRowProps {
  row: FileTreeRow
  focused: boolean
  selectedPath: string | undefined
  expandedDirectories: Set<string>
  checkerState: CheckerState
  recencyByPath: Map<string, number>
  now: number
  treeWidth: number
}

// Memoized so cursor moves and status updates do not re-render every row
export const TreeRow = memo(
  ({ row, focused, selectedPath, expandedDirectories, checkerState, recencyByPath, now, treeWidth }: TreeRowProps) => {
    const theme = useTheme()
    const node = row.node
    const indent = " ".repeat(Math.max(0, row.depth) * 2)
    const background = focused ? theme.colors.surface.cursor : theme.colors.surface.base
    const contentWidth = treeWidth - 4

    if (node.type === "directory") {
      const isExpanded = expandedDirectories.has(node.id)
      const chevron = isExpanded ? "▾" : "▸"
      const recency = directoryRecency(node, expandedDirectories, recencyByPath, now)
      const summary = isExpanded ? null : directorySummary(node.path, checkerState)
      const nameFg = focused ? theme.colors.text.selected : node.changedCount > 0 ? theme.colors.text.primary : theme.colors.text.strong
      const hasBadges =
        !isExpanded &&
        (node.changedCount > 0 ||
          Boolean(summary?.failed) ||
          Boolean(summary?.pending) ||
          (summary?.errors ?? 0) > 0 ||
          (summary?.warnings ?? 0) > 0)
      const badgeReserve = hasBadges ? 14 : 0
      const maxNameLen = contentWidth - indent.length - 2 - badgeReserve
      return (
        <box
          id={node.id}
          width="100%"
          flexDirection="row"
          justifyContent="space-between"
          paddingLeft={1}
          paddingRight={1}
          backgroundColor={background}
        >
          <box flexDirection="row">
            <text fg={nameFg}>{`${indent}${chevron} ${truncateName(`${node.name}/`, maxNameLen)}`}</text>
            <RecencyDot level={recency} />
          </box>
          <box flexDirection="row">
            {summary?.failed ? <text fg={theme.colors.severity.error}>fail </text> : null}
            {summary !== null && summary.errors > 0 ? <text fg={theme.colors.severity.error}>{`✖${summary.errors} `}</text> : null}
            {summary !== null && summary.errors === 0 && summary.warnings > 0 ? (
              <text fg={theme.colors.severity.warning}>{`⚠${summary.warnings} `}</text>
            ) : null}
            {summary?.pending ? <text fg={theme.colors.text.muted}>… </text> : null}
            {summary !== null &&
            node.changedCount > 0 &&
            !summary.failed &&
            !summary.pending &&
            summary.errors === 0 &&
            summary.warnings === 0 ? (
              <text fg={theme.colors.success}>✓ </text>
            ) : null}
            {node.changedCount > 0 ? (
              <text
                fg={node.stage !== undefined ? theme.colors.stage[node.stage] : theme.colors.text.muted}
              >{`+${node.additions} -${node.deletions}`}</text>
            ) : null}
          </box>
        </box>
      )
    }

    const changed = node.changed
    const recency = recencyLevel(recencyByPath.get(node.path), now)
    const summary = checkerSummary(node.path, checkerState)
    const selected = selectedPath === node.path
    const nameFg =
      focused || selected
        ? theme.colors.text.selected
        : changed === undefined
          ? theme.colors.text.secondary
          : theme.colors.kind[changed.kind]
    const pending = changed !== undefined && summary.pending
    const hasBadges = changed !== undefined || summary.failed || summary.errors > 0 || summary.warnings > 0 || summary.pending
    const badgeReserve = hasBadges ? 14 : 0

    return (
      <box
        id={node.id}
        width="100%"
        flexDirection="row"
        justifyContent="space-between"
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={background}
      >
        <box flexDirection="row">
          <text fg={nameFg}>{`${indent}${truncateName(node.name, contentWidth - indent.length - badgeReserve)}`}</text>
          <RecencyDot level={recency} />
        </box>
        <box flexDirection="row">
          {summary.failed ? <text fg={theme.colors.severity.error}>fail </text> : null}
          {summary.errors > 0 ? <text fg={theme.colors.severity.error}>{`✖${summary.errors} `}</text> : null}
          {summary.errors === 0 && summary.warnings > 0 ? <text fg={theme.colors.severity.warning}>{`⚠${summary.warnings} `}</text> : null}
          {changed !== undefined && changed.warnings.length > 0 ? <text fg={theme.colors.severity.warning}>! </text> : null}
          {changed !== undefined && !pending && !summary.failed && summary.errors === 0 && summary.warnings === 0 ? (
            <text fg={theme.colors.success}>✓ </text>
          ) : null}
          {changed === undefined ? null : <text fg={theme.colors.text.muted}>{`+${changed.additions} -${changed.deletions} `}</text>}
          {pending ? <text fg={theme.colors.text.muted}>… </text> : null}
          {changed === undefined ? null : <text fg={theme.colors.stage[changed.stage]}>{kindLetter(changed.kind)}</text>}
        </box>
      </box>
    )
  },
)

export function RecencyDot({ level }: { level: RecencyLevel }) {
  const theme = useTheme()
  if (level === "none") {
    return null
  }

  return <text fg={level === "fresh" ? theme.colors.accent.primary : theme.colors.accent.dim}> ●</text>
}

function directoryRecency(
  node: DirectoryNode,
  expandedDirectories: Set<string>,
  recencyByPath: Map<string, number>,
  now: number,
): RecencyLevel {
  if (expandedDirectories.has(node.id)) {
    return "none"
  }

  const prefix = `${node.path}/`
  let level: RecencyLevel = "none"
  for (const [path, at] of recencyByPath) {
    if (!path.startsWith(prefix)) {
      continue
    }

    const pathLevel = recencyLevel(at, now)
    if (pathLevel === "fresh") {
      return "fresh"
    }

    if (pathLevel === "recent") {
      level = "recent"
    }
  }

  return level
}
