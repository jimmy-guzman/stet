import { useTheme } from "../theme/context"

interface StatusBarProps {
  hints: string
  statusRight: string
}

export function StatusBar({ hints, statusRight }: StatusBarProps) {
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
      <text fg={theme.colors.text.muted}>{hints}</text>
      <text fg={theme.colors.text.secondary}>{statusRight}</text>
    </box>
  )
}
