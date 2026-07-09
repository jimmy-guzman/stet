import { createMemo } from "solid-js";

import { levelColor, levelGlyph } from "@/log/levels";
import { state } from "@/state";
import { useTheme } from "@/theme/context";

export function StatusBar() {
  const theme = useTheme();
  // Pair the level glyph with its color so severity reads without relying on color
  // Alone, the way the counts badge and problems panel already do. An idle bar (no
  // Leveled message) renders bare: no glyph, neutral color.
  const status = createMemo(() => {
    const level = state.statusRightLevel();
    const text = state.statusRight();
    return level === undefined
      ? { fg: theme.colors.text.secondary, text }
      : { fg: levelColor(theme.colors, level), text: `${levelGlyph(level)} ${text}` };
  });
  return (
    <box
      height={1}
      flexDirection="row"
      justifyContent="space-between"
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={theme.colors.surface.base}
    >
      <text fg={theme.colors.text.muted}>{state.statusHint()}</text>
      <text fg={status().fg}>{status().text}</text>
    </box>
  );
}
