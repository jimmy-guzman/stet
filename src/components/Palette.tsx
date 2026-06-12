import type { ScrollBoxRenderable } from "@opentui/core"
import type { RefObject } from "react"
import { recencyLevel } from "../activity"
import type { ChangedFile } from "../git"
import { useTheme } from "../theme/context"
import { kindLetter } from "../ui-helpers"
import { RecencyDot } from "./TreeRow"

interface PaletteProps {
  paletteRef: RefObject<ScrollBoxRenderable | null>
  paletteLeft: number
  paletteWidth: number
  paletteResults: string[]
  paletteIndex: number
  changedByPath: Map<string, ChangedFile>
  recencyByPath: Map<string, number>
  now: number
  onInput: (value: string) => void
  onSubmit: () => void
}

export function Palette({
  paletteRef,
  paletteLeft,
  paletteWidth,
  paletteResults,
  paletteIndex,
  changedByPath,
  recencyByPath,
  now,
  onInput,
  onSubmit,
}: PaletteProps) {
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
      <input
        focused
        width="100%"
        placeholder="go to file…"
        backgroundColor={theme.colors.surface.panel}
        focusedBackgroundColor={theme.colors.surface.panel}
        textColor={theme.colors.text.primary}
        cursorColor={theme.colors.accent.primary}
        onInput={onInput}
        onSubmit={onSubmit}
      />
      <scrollbox ref={paletteRef} width="100%" height={Math.min(12, Math.max(1, paletteResults.length))} scrollY viewportCulling>
        {paletteResults.length === 0 ? (
          <box id="palette-empty" paddingLeft={1}>
            <text fg={theme.colors.text.muted}>no matches</text>
          </box>
        ) : (
          paletteResults.map((path, index) => {
            const changed = changedByPath.get(path)
            const recency = recencyLevel(recencyByPath.get(path), now)
            // Key and id both by index: reordering results must never
            // Change a live renderable's id or the scrollbox loses rows
            // oxlint-disable react/no-array-index-key -- intentional: stable id-by-index required by scrollbox
            return (
              <box
                key={`palette-${index}`}
                id={`palette-${index}`}
                width="100%"
                flexDirection="row"
                justifyContent="space-between"
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={index === paletteIndex ? theme.colors.surface.cursor : theme.colors.surface.panel}
              >
                <box flexDirection="row">
                  <text
                    fg={
                      index === paletteIndex
                        ? theme.colors.text.selected
                        : changed === undefined
                          ? theme.colors.text.secondary
                          : theme.colors.kind[changed.kind]
                    }
                  >
                    {path}
                  </text>
                  <RecencyDot level={recency} />
                </box>
                {changed === undefined ? null : <text fg={theme.colors.stage[changed.stage]}>{kindLetter(changed.kind)}</text>}
              </box>
            )
            // oxlint-enable react/no-array-index-key
          })
        )}
      </scrollbox>
    </box>
  )
}
