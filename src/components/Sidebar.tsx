import type { ScrollBoxRenderable } from "@opentui/core"
import type { RefObject } from "react"
import type { CheckerState } from "../diagnostics"
import { useTheme } from "../theme/context"
import type { FileTreeRow } from "../tree"
import { TreeRow } from "./TreeRow"

interface SidebarProps {
  sidebarRef: RefObject<ScrollBoxRenderable | null>
  sidebarWidth: number
  paneHeight: number
  focused: boolean
  treeRows: FileTreeRow[]
  focusedRowIndex: number
  selectedPath: string | undefined
  expandedDirectories: Set<string>
  checkerState: CheckerState
  recencyByPath: Map<string, number>
  now: number
}

export function Sidebar({
  sidebarRef,
  sidebarWidth,
  paneHeight,
  focused,
  treeRows,
  focusedRowIndex,
  selectedPath,
  expandedDirectories,
  checkerState,
  recencyByPath,
  now,
}: SidebarProps) {
  const theme = useTheme()
  return (
    <box
      width={sidebarWidth}
      height="100%"
      flexDirection="column"
      borderStyle="single"
      borderColor={focused ? theme.colors.border.focused : theme.colors.border.unfocused}
    >
      <scrollbox ref={sidebarRef} width="100%" height={paneHeight} scrollY viewportCulling>
        {treeRows.map((row) => (
          <TreeRow
            key={row.node.id}
            row={row}
            focused={row.index === focusedRowIndex}
            selectedPath={selectedPath}
            expandedDirectories={expandedDirectories}
            checkerState={checkerState}
            recencyByPath={recencyByPath}
            now={now}
            treeWidth={sidebarWidth}
          />
        ))}
        {treeRows.length < paneHeight && (
          <box id="tree-filler" width="100%" height={paneHeight - treeRows.length} backgroundColor={theme.colors.surface.base} />
        )}
      </scrollbox>
    </box>
  )
}
