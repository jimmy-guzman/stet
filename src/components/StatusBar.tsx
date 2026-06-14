import { state } from "../state"
import { useTheme } from "../theme/context"

export function StatusBar() {
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
      <text fg={theme.colors.text.muted}>? keys · q quit</text>
      <text fg={theme.colors.text.secondary}>{state.statusRight()}</text>
    </box>
  )
}
