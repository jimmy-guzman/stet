import type { DiffRenderable } from "@opentui/core"
import type { RefObject } from "react"
import { DIFF_ID } from "../constants"
import type { FileContent } from "../file-view"
import type { ChangedFile } from "../git"
import { diffFiletypeFor, type SyntaxConfig } from "../syntax"
import { useTheme } from "../theme/context"
import { placeholderText, viewerTitle } from "../ui-helpers"

interface ViewerProps {
  diffRef: RefObject<DiffRenderable | null>
  focused: boolean
  viewerHeight: number
  selectedPath: string | undefined
  selectedFile: ChangedFile | undefined
  showFileContent: boolean
  fileContent: FileContent | undefined
  cursorLineNumber: number | undefined
  diff: string
  fullContent: boolean
  syntax: SyntaxConfig
}

export function Viewer({
  diffRef,
  focused,
  viewerHeight,
  selectedPath,
  selectedFile,
  showFileContent,
  fileContent,
  cursorLineNumber,
  diff,
  fullContent,
  syntax,
}: ViewerProps) {
  const theme = useTheme()
  return (
    <box
      flexGrow={1}
      height="100%"
      flexDirection="column"
      borderStyle="single"
      borderColor={focused ? theme.colors.border.focused : theme.colors.border.unfocused}
    >
      <box height={1} flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1}>
        <text fg={theme.colors.text.primary}>{viewerTitle(selectedPath, selectedFile, showFileContent, fileContent)}</text>
        <text fg={theme.colors.text.muted}>
          {showFileContent ? "file" : "diff"}
          {cursorLineNumber === undefined ? "" : ` · ln ${cursorLineNumber}`}
        </text>
      </box>
      {showFileContent && fileContent !== undefined && fileContent.kind !== "text" ? (
        <box height={viewerHeight} paddingLeft={1}>
          <text fg={theme.colors.text.muted}>{placeholderText(fileContent)}</text>
        </box>
      ) : (
        <diff
          id={DIFF_ID}
          ref={diffRef}
          key={`${selectedPath ?? "empty"}:${showFileContent}:${fullContent}`}
          width="100%"
          height={viewerHeight}
          diff={diff}
          view="unified"
          filetype={selectedPath === undefined ? "text" : diffFiletypeFor(selectedPath, syntax)}
          syntaxStyle={syntax.enabled ? syntax.style : undefined}
          treeSitterClient={syntax.enabled ? syntax.treeSitterClient : undefined}
          showLineNumbers
          wrapMode="none"
          addedBg={theme.colors.diff.addedBg}
          removedBg={theme.colors.diff.removedBg}
          addedLineNumberBg={theme.colors.diff.addedLineNumberBg}
          removedLineNumberBg={theme.colors.diff.removedLineNumberBg}
          addedSignColor={theme.colors.diff.addedSign}
          removedSignColor={theme.colors.diff.removedSign}
          lineNumberFg={theme.colors.diff.lineNumberFg}
        />
      )}
    </box>
  )
}
