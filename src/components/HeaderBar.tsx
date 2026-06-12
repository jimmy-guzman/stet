import { basename } from "node:path"
import { scopeLabel, type DiffScope } from "../cli"
import { useTheme } from "../theme/context"

interface HeaderBarProps {
  version: string
  repoRoot: string
  scope: DiffScope
  changedCount: number
  countsText: string
}

export function HeaderBar({ version, repoRoot, scope, changedCount, countsText }: HeaderBarProps) {
  const theme = useTheme()
  return (
    <box
      height={1}
      flexDirection="row"
      justifyContent="space-between"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={theme.colors.surface.panel}
    >
      <box flexDirection="row">
        <text fg={theme.colors.accent.primary}>sideye</text>
        <text fg={theme.colors.text.faint}>@{version}</text>
      </box>
      <text fg={theme.colors.text.secondary}>
        {basename(repoRoot)} · {scopeLabel(scope)} · {changedCount} changed{countsText === "" ? "" : ` · ${countsText}`}
      </text>
    </box>
  )
}
