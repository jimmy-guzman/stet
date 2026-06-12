import type { KeyEvent } from "@opentui/core"
import type { Dispatch, RefObject, SetStateAction } from "react"
import type { ActivityLog } from "./activity"
import { latestActivity } from "./activity"
import { nextScope, scopeLabel, type DiffScope } from "./cli"
import { copyToClipboard, formatCopyReference } from "./copy-reference"
import type { Diagnostic } from "./diagnostics"
import type { ChangedFile, GitModel, Worktree } from "./git"
import { listWorktrees } from "./git"
import type { ProblemItem } from "./hooks/useDiagnostics"
import type { JumpTarget } from "./hooks/useDiffCursor"
import { lineReference, type ParsedDiffLine } from "./patch"
import { firstFileInNode, type FileTreeRow } from "./tree"
import { nextFindingPath, orderedFindingPaths } from "./ui-helpers"

type FocusedPane = "tree" | "diff" | "problems"

export interface KeyHandlerCtx {
  helpOpen: boolean
  worktreeOpen: boolean
  worktrees: Worktree[] | undefined
  worktreeIndex: number
  paletteOpen: boolean
  paletteResults: string[]
  problemsOpen: boolean
  focusedPane: FocusedPane
  model: GitModel
  activityLog: ActivityLog
  selectedFile: ChangedFile | undefined
  selectedPath: string | undefined
  navigableLines: ParsedDiffLine[]
  cursorIndex: number
  problems: Diagnostic[]
  allProblemItems: ProblemItem[]
  problemIndex: number
  treeRows: FileTreeRow[]
  focusedRowIndex: number
  viewerHeight: number
  worktreeRequestRef: RefObject<number>
  quit: () => void
  switchWorktree: (worktree: Worktree) => Promise<void> | void
  selectFile: (path: string) => void
  runChecks: () => void
  setHelpOpen: Dispatch<SetStateAction<boolean>>
  setWorktreeOpen: Dispatch<SetStateAction<boolean>>
  setWorktreeIndex: Dispatch<SetStateAction<number>>
  setWorktrees: Dispatch<SetStateAction<Worktree[] | undefined>>
  setPaletteOpen: Dispatch<SetStateAction<boolean>>
  setPaletteQuery: Dispatch<SetStateAction<string>>
  setPaletteIndex: Dispatch<SetStateAction<number>>
  setProblemsOpen: Dispatch<SetStateAction<boolean>>
  setProblemIndex: Dispatch<SetStateAction<number>>
  setFocusedPane: Dispatch<SetStateAction<FocusedPane>>
  setSidebarOpen: Dispatch<SetStateAction<boolean>>
  setStatus: Dispatch<SetStateAction<string>>
  setScope: Dispatch<SetStateAction<DiffScope>>
  setChangesOnly: Dispatch<SetStateAction<boolean>>
  setJumpTarget: Dispatch<SetStateAction<JumpTarget | undefined>>
  setFileView: Dispatch<SetStateAction<boolean>>
  setFullContentPaths: Dispatch<SetStateAction<Set<string>>>
  setCursorIndex: Dispatch<SetStateAction<number>>
  setFocusedRowIndex: Dispatch<SetStateAction<number>>
  setExpandedDirectories: Dispatch<SetStateAction<Set<string>>>
}

// One handler routes every key through the modal-precedence chain
// (help > worktree > palette > global > pane-specific). The order of the early
// Returns is load-bearing: an open overlay must swallow keys before any later
// Branch can act on them. App rebuilds ctx each render so the closure stays fresh.
export function createKeyHandler(ctx: KeyHandlerCtx) {
  const {
    helpOpen,
    worktreeOpen,
    worktrees,
    worktreeIndex,
    paletteOpen,
    paletteResults,
    problemsOpen,
    focusedPane,
    model,
    activityLog,
    selectedFile,
    selectedPath,
    navigableLines,
    cursorIndex,
    problems,
    allProblemItems,
    problemIndex,
    treeRows,
    focusedRowIndex,
    viewerHeight,
    worktreeRequestRef,
    quit,
    switchWorktree,
    selectFile,
    runChecks,
    setHelpOpen,
    setWorktreeOpen,
    setWorktreeIndex,
    setWorktrees,
    setPaletteOpen,
    setPaletteQuery,
    setPaletteIndex,
    setProblemsOpen,
    setProblemIndex,
    setFocusedPane,
    setSidebarOpen,
    setStatus,
    setScope,
    setChangesOnly,
    setJumpTarget,
    setFileView,
    setFullContentPaths,
    setCursorIndex,
    setFocusedRowIndex,
    setExpandedDirectories,
  } = ctx

  return (key: KeyEvent) => {
    if (helpOpen) {
      if (key.name === "escape" || key.name === "?" || key.name === "q") {
        setHelpOpen(false)
      }
      // Every other key belongs to the help overlay
      return
    }

    if (worktreeOpen) {
      const lastIndex = Math.max(0, (worktrees?.length ?? 1) - 1)
      if (key.name === "escape" || key.name === "w") {
        worktreeRequestRef.current += 1
        setWorktreeOpen(false)
      } else if (key.name === "j" || key.name === "down") {
        setWorktreeIndex((current) => Math.min(current + 1, lastIndex))
      } else if (key.name === "k" || key.name === "up") {
        setWorktreeIndex((current) => Math.max(current - 1, 0))
      } else if (key.name === "return") {
        const worktree = worktrees?.[worktreeIndex]
        if (worktree !== undefined) {
          void switchWorktree(worktree)
        }
      }
      // Every other key belongs to the picker
      return
    }

    if (paletteOpen) {
      if (key.name === "escape") {
        setPaletteOpen(false)
      } else if (key.name === "down" || (key.ctrl && key.name === "n")) {
        setPaletteIndex((current) => Math.min(current + 1, Math.max(0, paletteResults.length - 1)))
      } else if (key.name === "up" || (key.ctrl && key.name === "p")) {
        setPaletteIndex((current) => Math.max(current - 1, 0))
      }
      // Every other key belongs to the palette input
      return
    }

    if (key.ctrl && key.name === "p") {
      setPaletteOpen(true)
      setPaletteQuery("")
      setPaletteIndex(0)
      return
    }

    if (key.name === "q") {
      quit()
      return
    }

    if (key.name === "escape") {
      if (problemsOpen) {
        setProblemsOpen(false)
        setFocusedPane((current) => (current === "problems" ? "tree" : current))
      } else {
        quit()
      }
      return
    }

    if (key.name === "tab") {
      setFocusedPane((current) => (current === "diff" ? "tree" : "diff"))
      return
    }

    if (key.name === "p") {
      setProblemsOpen((open) => {
        setFocusedPane(open ? "tree" : "problems")
        return !open
      })
      return
    }

    if (key.name === "b") {
      setSidebarOpen((open) => {
        if (open && focusedPane === "tree") {
          setFocusedPane("diff")
        }
        return !open
      })
      return
    }

    if (key.name === "?") {
      setHelpOpen(true)
      return
    }

    if (key.name === "w") {
      const request = worktreeRequestRef.current + 1
      worktreeRequestRef.current = request
      setWorktreeOpen(true)
      setWorktreeIndex(0)
      setWorktrees(undefined)
      void listWorktrees(model.repoRoot)
        .then((list) => {
          if (worktreeRequestRef.current !== request) {
            return
          }
          // Bare entries have no files to review
          const selectable = list.filter((worktree) => !worktree.bare)
          setWorktrees(selectable)
          setWorktreeIndex(
            Math.max(
              0,
              selectable.findIndex((worktree) => worktree.path === model.repoRoot),
            ),
          )
        })
        .catch((error: unknown) => {
          if (worktreeRequestRef.current !== request) {
            return
          }
          setWorktreeOpen(false)
          setStatus(error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error))
        })
      return
    }

    if (key.name === "s") {
      setScope((current) => {
        const next = { ...current, kind: nextScope(current.kind) }
        setStatus(`scope: ${scopeLabel(next)}`)
        return next
      })
      return
    }

    if (key.name === "c") {
      setChangesOnly((current) => {
        setStatus(current ? "showing all files" : "showing changes only")
        return !current
      })
      return
    }

    if (key.name === ".") {
      const latest = latestActivity(activityLog)
      if (latest !== undefined) {
        selectFile(latest.path)
      }
      return
    }

    if (key.name === "v" && selectedFile !== undefined && selectedPath !== undefined) {
      const line = navigableLines[cursorIndex]
      const lineNumber = line?.newLine ?? line?.oldLine
      if (lineNumber !== undefined) {
        setJumpTarget({ escalate: false, line: lineNumber, path: selectedPath })
      }
      setFileView((current) => !current)
      return
    }

    if (key.name === "n") {
      const paths = orderedFindingPaths(problems)
      const next = nextFindingPath(paths, selectedPath)
      if (next !== undefined) {
        selectFile(next)
      }
      return
    }

    if (key.name === "r") {
      void runChecks()
      return
    }

    if (key.name === "f" && selectedPath !== undefined) {
      setFullContentPaths((current) => new Set(current).add(selectedPath))
      setStatus(`loaded full content for ${selectedPath}`)
      return
    }

    if (key.name === "y" && selectedPath !== undefined) {
      try {
        const line = navigableLines[cursorIndex]
        const reference = line === undefined ? { path: selectedPath } : lineReference(selectedPath, line)
        copyToClipboard(formatCopyReference(reference))
        setStatus(`copied ${formatCopyReference(reference).split("\n")[0]}`)
      } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error))
      }
      return
    }

    if (focusedPane === "problems") {
      if (key.name === "j" || key.name === "down") {
        setProblemIndex((current) => Math.min(current + 1, Math.max(0, allProblemItems.length - 1)))
      } else if (key.name === "k" || key.name === "up") {
        setProblemIndex((current) => Math.max(current - 1, 0))
      } else if (key.name === "return") {
        const item = allProblemItems[problemIndex]
        if (item?.kind === "problem") {
          const { problem } = item
          selectFile(problem.path)
          if (problem.line !== undefined) {
            setJumpTarget({ escalate: true, line: problem.line, path: problem.path })
          }
          setFocusedPane("diff")
        }
      }
      return
    }

    if (focusedPane === "diff") {
      const last = navigableLines.length - 1
      const halfPage = Math.max(1, Math.floor(viewerHeight / 2))

      if (key.name === "j" || key.name === "down") {
        setCursorIndex((current) => Math.max(0, Math.min(current + 1, last)))
      } else if (key.name === "k" || key.name === "up") {
        setCursorIndex((current) => Math.max(current - 1, 0))
      } else if (key.ctrl && key.name === "d") {
        setCursorIndex((current) => Math.max(0, Math.min(current + halfPage, last)))
      } else if (key.ctrl && key.name === "u") {
        setCursorIndex((current) => Math.max(current - halfPage, 0))
      } else if (key.name === "g" && !key.shift) {
        setCursorIndex(0)
      } else if (key.name === "g" || key.name === "G") {
        setCursorIndex(Math.max(0, last))
      } else if (key.name === "h" || key.name === "left") {
        setFocusedPane("tree")
      }

      return
    }

    if (key.name === "j" || key.name === "down") {
      moveFocus(1, treeRows, setFocusedRowIndex, selectFile)
      return
    }

    if (key.name === "k" || key.name === "up") {
      moveFocus(-1, treeRows, setFocusedRowIndex, selectFile)
      return
    }

    if (key.name === "l" || key.name === "right") {
      const row = treeRows[focusedRowIndex]
      if (row?.node.type === "directory") {
        setExpandedDirectories((current) => new Set(current).add(row.node.id))
      } else if (row?.node.type === "file") {
        selectFile(row.node.path)
      }
      return
    }

    if (key.name === "h" || key.name === "left") {
      const row = treeRows[focusedRowIndex]
      if (row?.node.type === "directory") {
        setExpandedDirectories((current) => {
          const next = new Set(current)
          next.delete(row.node.id)
          return next
        })
      }
      return
    }

    if (key.name === "return") {
      const row = treeRows[focusedRowIndex]
      if (row !== undefined) {
        const file = firstFileInNode(row.node)
        if (file !== undefined) {
          selectFile(file.path)
        }
      }
    }
  }
}

function moveFocus(
  direction: -1 | 1,
  rows: FileTreeRow[],
  setFocusedRowIndex: (updater: (current: number) => number) => void,
  selectFile: (path: string) => void,
) {
  setFocusedRowIndex((current) => {
    const next = Math.max(0, Math.min(current + direction, rows.length - 1))
    const row = rows[next]
    if (row?.node.type === "file") {
      selectFile(row.node.path)
    }
    return next
  })
}
