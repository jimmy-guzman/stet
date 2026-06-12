import type { ScrollBoxRenderable } from "@opentui/core"
import type { RefObject } from "react"
import type { Worktree } from "../git"
import { useTheme } from "../theme/context"
import { collapseHome, truncateLeft, worktreeLabel } from "../ui-helpers"

interface WorktreePickerProps {
  worktreeRef: RefObject<ScrollBoxRenderable | null>
  paletteLeft: number
  paletteWidth: number
  worktrees: Worktree[] | undefined
  worktreeIndex: number
  repoRoot: string
}

export function WorktreePicker({ worktreeRef, paletteLeft, paletteWidth, worktrees, worktreeIndex, repoRoot }: WorktreePickerProps) {
  const theme = useTheme()
  return (
    <box
      position="absolute"
      left={paletteLeft}
      top={1}
      width={paletteWidth}
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.colors.border.focused}
      backgroundColor={theme.colors.surface.panel}
      zIndex={100}
    >
      <box height={1} paddingLeft={1} backgroundColor={theme.colors.surface.panel}>
        <text fg={theme.colors.accent.primary}>worktrees</text>
      </box>
      <scrollbox ref={worktreeRef} width="100%" height={Math.min(12, Math.max(1, worktrees?.length ?? 1))} scrollY viewportCulling>
        {worktrees === undefined ? (
          <box id="worktree-loading" paddingLeft={1}>
            <text fg={theme.colors.text.muted}>loading…</text>
          </box>
        ) : worktrees.length === 0 ? (
          <box id="worktree-empty" paddingLeft={1}>
            <text fg={theme.colors.text.muted}>no worktrees</text>
          </box>
        ) : (
          worktrees.map((worktree, index) => {
            const current = worktree.path === repoRoot
            const badges = [worktree.locked ? "locked" : "", worktree.prunable ? "prunable" : ""].filter((badge) => badge !== "").join(" ")
            // Key and id both by index: reordering results must never
            // Change a live renderable's id or the scrollbox loses rows
            // oxlint-disable react/no-array-index-key -- intentional: stable id-by-index required by scrollbox
            return (
              <box
                key={`worktree-${index}`}
                id={`worktree-${index}`}
                width="100%"
                flexDirection="row"
                justifyContent="space-between"
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={index === worktreeIndex ? theme.colors.surface.cursor : theme.colors.surface.panel}
              >
                <text
                  fg={
                    index === worktreeIndex ? theme.colors.text.selected : current ? theme.colors.accent.primary : theme.colors.text.strong
                  }
                >
                  {`${current ? "● " : "  "}${worktreeLabel(worktree)}`}
                </text>
                <box flexDirection="row">
                  {badges === "" ? null : <text fg={theme.colors.severity.warning}>{`${badges} `}</text>}
                  <text fg={theme.colors.text.muted}>
                    {truncateLeft(collapseHome(worktree.path), Math.max(10, paletteWidth - worktreeLabel(worktree).length - 16))}
                  </text>
                </box>
              </box>
            )
            // oxlint-enable react/no-array-index-key
          })
        )}
      </scrollbox>
    </box>
  )
}
