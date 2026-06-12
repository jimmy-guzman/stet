import { useTheme } from "../theme/context"

// Mirrors the Keys table in README.md
const KEY_HELP: [combo: string, action: string][] = [
  ["j / k", "move in the tree, viewer, or problems panel"],
  ["h / l", "collapse / expand folders"],
  ["tab", "switch focus between tree and viewer"],
  ["enter", "open the focused item / jump to a problem"],
  ["ctrl-p", "go to file: fuzzy-search the whole repo"],
  ["s", "cycle scope: all changes → staged → unstaged"],
  ["w", "switch to another git worktree"],
  ["c", "toggle changes-only filter for the tree"],
  ["v", "toggle diff ↔ full file view for a changed file"],
  ["p", "toggle the problems panel"],
  ["b", "toggle the file tree sidebar"],
  [".", "jump to the most recently changed file"],
  ["n", "jump to the next file with findings"],
  ["y", "copy path:line + snippet at the cursor"],
  ["f", "load full content when truncated"],
  ["r", "re-run checks"],
  ["ctrl-d/u", "half-page cursor movement in the viewer"],
  ["g / G", "jump to first / last line"],
  ["?", "show all keybindings"],
  ["q / esc", "quit (esc closes panels first)"],
]

interface HelpOverlayProps {
  paletteLeft: number
  paletteWidth: number
  height: number
}

export function HelpOverlay({ paletteLeft, paletteWidth, height }: HelpOverlayProps) {
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
        <text fg={theme.colors.accent.primary}>keys</text>
      </box>
      <scrollbox width="100%" height={Math.min(KEY_HELP.length, Math.max(1, height - 6))} scrollY viewportCulling>
        {KEY_HELP.map(([combo, action]) => (
          <box
            key={combo}
            id={`help-${combo}`}
            width="100%"
            flexDirection="row"
            paddingLeft={1}
            paddingRight={1}
            backgroundColor={theme.colors.surface.panel}
          >
            <text fg={theme.colors.accent.primary}>{combo.padEnd(11)}</text>
            <text fg={theme.colors.text.secondary}>{action}</text>
          </box>
        ))}
      </scrollbox>
    </box>
  )
}
