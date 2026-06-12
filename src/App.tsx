import { existsSync } from "node:fs"
import packageJson from "../package.json"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { emptyActivityLog, latestActivity, recordActivity, RECENT_MS } from "./activity"
import type { DiffScope } from "./cli"
import { HeaderBar } from "./components/HeaderBar"
import { HelpOverlay } from "./components/HelpOverlay"
import { Palette } from "./components/Palette"
import { ProblemsPanel } from "./components/ProblemsPanel"
import { Sidebar } from "./components/Sidebar"
import { StatusBar } from "./components/StatusBar"
import { Viewer } from "./components/Viewer"
import { WorktreePicker } from "./components/WorktreePicker"
import { PROBLEMS_HEIGHT } from "./constants"
import { findingsLineMap, markPending, type Diagnostic } from "./diagnostics"
import { contentToContextPatch, loadFileContent, type FileContent } from "./file-view"
import { rankFiles } from "./fuzzy"
import type { GitModel, Worktree } from "./git"
import { loadFileDiff, loadGitModel } from "./git"
import { useActivity } from "./hooks/useActivity"
import { useDiagnostics } from "./hooks/useDiagnostics"
import { useDiffCursor } from "./hooks/useDiffCursor"
import { useGitModel } from "./hooks/useGitModel"
import { createKeyHandler } from "./keymap"
import { renderPatch } from "./patch"
import type { SyntaxConfig } from "./syntax"
import { useTheme } from "./theme/context"
import { buildFileTree, defaultExpandedDirectories, expandAncestorsForPath, findRowIndexForPath, flattenTree } from "./tree"
import { truncate, worktreeLabel } from "./ui-helpers"

interface AppProps {
  model: GitModel
  scope: DiffScope
  syntax: SyntaxConfig
}

export function App({ model: initialModel, scope: initialScope, syntax }: AppProps) {
  const renderer = useRenderer()
  const theme = useTheme()
  const { width, height } = useTerminalDimensions()
  const [scope, setScope] = useState(initialScope)
  const { lastChangeRef, model, previousChangedRef, previousScopeKeyRef, setModel } = useGitModel(initialModel, scope)
  const [changesOnly, setChangesOnly] = useState(false)
  const [selectedPath, setSelectedPath] = useState<string | undefined>(initialModel.changed[0]?.path ?? initialModel.repoFiles[0]?.path)
  const [focusedRowIndex, setFocusedRowIndex] = useState(0)
  const [expandedDirectories, setExpandedDirectories] = useState(() => {
    const expanded = defaultExpandedDirectories(initialModel.changed.map((file) => file.path))
    const selected = initialModel.changed[0]?.path ?? initialModel.repoFiles[0]?.path
    return selected === undefined ? expanded : expandAncestorsForPath(expanded, selected)
  })
  const [fullContentPaths, setFullContentPaths] = useState<Set<string>>(() => new Set())
  const [fileView, setFileView] = useState(false)
  const [focusedPane, setFocusedPane] = useState<"tree" | "diff" | "problems">("tree")
  const [problemsOpen, setProblemsOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [problemIndex, setProblemIndex] = useState(0)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState("")
  const [paletteIndex, setPaletteIndex] = useState(0)
  const [worktreeOpen, setWorktreeOpen] = useState(false)
  const [worktreeIndex, setWorktreeIndex] = useState(0)
  const [worktrees, setWorktrees] = useState<Worktree[] | undefined>(undefined)
  const [helpOpen, setHelpOpen] = useState(false)
  const { activityLog, setActivityLog, now, recencyByPath } = useActivity()
  const {
    abortRef,
    allProblemItems,
    checkerState,
    checksInFlight,
    counts,
    problems,
    runChecks,
    runChecksRef,
    setCheckerState,
    setStatus,
    status,
  } = useDiagnostics(model, activityLog, syntax.status)
  const sidebarRef = useRef<ScrollBoxRenderable>(null)
  const problemsRef = useRef<ScrollBoxRenderable>(null)
  const paletteRef = useRef<ScrollBoxRenderable>(null)
  const worktreeRef = useRef<ScrollBoxRenderable>(null)
  // Bumped on every picker open/close so a slow listWorktrees from an earlier
  // Open cannot repopulate or close a newer picker
  const worktreeRequestRef = useRef(0)

  const selectedFile = selectedPath === undefined ? undefined : model.changedByPath.get(selectedPath)
  const showFileContent = selectedPath !== undefined && (selectedFile === undefined || fileView)
  const tree = useMemo(
    () => buildFileTree(model.repoFiles, model.changedByPath, { changesOnly }),
    [changesOnly, model.changedByPath, model.repoFiles],
  )
  const treeRows = useMemo(() => flattenTree(tree, expandedDirectories), [expandedDirectories, tree])
  const changedPathSet = useMemo(() => new Set(model.changedByPath.keys()), [model.changedByPath])
  // Hoisted out of paletteResults so a keystroke only pays for ranking
  const allPaths = useMemo(
    () => [...new Set([...model.repoFiles.map((file) => file.path), ...model.changedByPath.keys()])],
    [model.changedByPath, model.repoFiles],
  )
  const paletteResults = useMemo(() => {
    if (!paletteOpen) {
      return []
    }

    return rankFiles(paletteQuery, allPaths, { changed: changedPathSet, lastChangedAt: recencyByPath, limit: 50 })
  }, [allPaths, changedPathSet, paletteOpen, paletteQuery, recencyByPath])
  const lineMap = useMemo(
    () => (selectedPath === undefined ? new Map<number, Diagnostic[]>() : findingsLineMap(selectedPath, checkerState)),
    [checkerState, selectedPath],
  )

  const fileContent = useMemo<FileContent | undefined>(() => {
    if (!showFileContent || selectedPath === undefined) {
      return undefined
    }

    const gitSpec =
      selectedFile?.kind === "deleted" ? (scope.kind === "unstaged" ? `:${selectedPath}` : `${scope.ref}:${selectedPath}`) : undefined
    return loadFileContent(model.repoRoot, selectedPath, { full: fullContentPaths.has(selectedPath), gitSpec })
    // Model identity changes whenever git state changes, keeping live content fresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFileContent, selectedPath, selectedFile, scope, model, fullContentPaths])

  const selectedDiff = useMemo(() => {
    if (selectedPath === undefined) {
      return ""
    }

    if (showFileContent) {
      return fileContent?.kind === "text" ? contentToContextPatch(selectedPath, fileContent.content) : ""
    }

    return selectedFile === undefined ? "" : loadFileDiff(model.repoRoot, scope, selectedFile)
  }, [fileContent, model.repoRoot, scope, selectedFile, selectedPath, showFileContent])

  const renderedPatch = useMemo(
    () =>
      renderPatch(selectedDiff, {
        full: showFileContent || (selectedPath !== undefined && fullContentPaths.has(selectedPath)),
        maxLines: 1600,
      }),
    [fullContentPaths, selectedDiff, selectedPath, showFileContent],
  )
  // Clamp navigation to the lines renderPatch actually emitted, not the full parse
  const navigableLines = useMemo(
    () => renderedPatch.parsed.hunks.flatMap((hunk) => hunk.lines).slice(0, renderedPatch.bodyLineCount),
    [renderedPatch],
  )
  const truncated = renderedPatch.truncated || (fileContent?.kind === "text" && fileContent.truncated)

  useEffect(() => {
    const previousByPath = new Map(previousChangedRef.current.map((file) => [file.path, file]))
    const previousScopeKey = previousScopeKeyRef.current
    previousChangedRef.current = model.changed
    previousScopeKeyRef.current = model.scopeKey

    // A scope switch swaps the changed set wholesale; that is not agent
    // Activity, but the new set still needs checker state, so re-run checks
    if (previousScopeKey !== model.scopeKey) {
      runChecksRef.current()
      return
    }

    const entries: { path: string; kind: "changed" | "appeared" | "removed" }[] = []

    for (const file of model.changed) {
      const before = previousByPath.get(file.path)
      if (before === undefined) {
        entries.push({ kind: "appeared", path: file.path })
      } else if (before.additions !== file.additions || before.deletions !== file.deletions) {
        entries.push({ kind: "changed", path: file.path })
      }
      previousByPath.delete(file.path)
    }

    for (const path of previousByPath.keys()) {
      entries.push({ kind: "removed", path })
    }

    if (entries.length > 0) {
      lastChangeRef.current = Date.now()
      setCheckerState((current) =>
        markPending(
          current,
          model.changed,
          entries.map((entry) => entry.path),
        ),
      )
      setActivityLog((current) => recordActivity(current, entries, Date.now()))
    }
  }, [model.changed, model.scopeKey, lastChangeRef, previousChangedRef, previousScopeKeyRef, runChecksRef, setActivityLog, setCheckerState])

  useEffect(() => {
    if (selectedPath === undefined) {
      return
    }

    const rowIndex = findRowIndexForPath(treeRows, selectedPath)
    if (rowIndex >= 0) {
      setFocusedRowIndex(rowIndex)
    }
  }, [selectedPath, treeRows])

  useEffect(() => {
    const focusedRow = treeRows[focusedRowIndex]
    if (focusedRow !== undefined) {
      sidebarRef.current?.scrollChildIntoView(focusedRow.node.id)
    }
  }, [focusedRowIndex, treeRows])

  useEffect(() => {
    if (problemsOpen) {
      problemsRef.current?.scrollChildIntoView(allProblemItems[problemIndex]?.id ?? "")
    }
  }, [allProblemItems, problemIndex, problemsOpen])

  useEffect(() => {
    if (paletteOpen) {
      paletteRef.current?.scrollChildIntoView(`palette-${paletteIndex}`)
    }
  }, [paletteIndex, paletteOpen])

  useEffect(() => {
    if (worktreeOpen) {
      worktreeRef.current?.scrollChildIntoView(`worktree-${worktreeIndex}`)
    }
  }, [worktreeIndex, worktreeOpen])

  const problemsHeight = problemsOpen ? PROBLEMS_HEIGHT : 0
  const paneHeight = Math.max(1, height - 4 - problemsHeight)
  // The viewer pane spends one extra row on its path header
  const viewerHeight = Math.max(1, paneHeight - 1)

  const { cursorIndex, diffRef, setCursorIndex, setJumpTarget } = useDiffCursor({
    fileView,
    fullContentPaths,
    lineMap,
    navigableLines,
    selectedFile,
    selectedPath,
    setFileView,
    setFullContentPaths,
    truncated,
    viewerHeight,
  })

  const selectFile = useCallback((path: string) => {
    setSelectedPath(path)
    setFileView(false)
    setExpandedDirectories((current) => expandAncestorsForPath(current, path))
  }, [])

  useKeyboard(
    createKeyHandler({
      activityLog,
      allProblemItems,
      cursorIndex,
      focusedPane,
      focusedRowIndex,
      helpOpen,
      model,
      navigableLines,
      paletteOpen,
      paletteResults,
      problemIndex,
      problems,
      problemsOpen,
      quit,
      runChecks,
      selectFile,
      selectedFile,
      selectedPath,
      setChangesOnly,
      setCursorIndex,
      setExpandedDirectories,
      setFileView,
      setFocusedPane,
      setFocusedRowIndex,
      setFullContentPaths,
      setHelpOpen,
      setJumpTarget,
      setPaletteIndex,
      setPaletteOpen,
      setPaletteQuery,
      setProblemIndex,
      setProblemsOpen,
      setScope,
      setSidebarOpen,
      setStatus,
      setWorktreeIndex,
      setWorktreeOpen,
      setWorktrees,
      switchWorktree,
      treeRows,
      viewerHeight,
      worktreeIndex,
      worktreeOpen,
      worktreeRequestRef,
      worktrees,
    }),
  )

  function quit() {
    abortRef.current?.abort()
    renderer.destroy()
  }

  async function switchWorktree(worktree: Worktree) {
    worktreeRequestRef.current += 1
    setWorktreeOpen(false)
    if (worktree.path === model.repoRoot) {
      return
    }

    if (!existsSync(worktree.path)) {
      setStatus(`worktree missing: ${worktree.path}`)
      return
    }

    try {
      const fresh = await loadGitModel(worktree.path, scope)
      abortRef.current?.abort()
      // Prime the activity refs so the swap is not mistaken for agent edits;
      // ScopeKey matches across worktrees, so that effect will not re-run checks
      previousChangedRef.current = fresh.changed
      previousScopeKeyRef.current = fresh.scopeKey
      lastChangeRef.current = Date.now()
      setModel(fresh)
      const selected = fresh.changed[0]?.path ?? fresh.repoFiles[0]?.path
      setSelectedPath(selected)
      setFocusedRowIndex(0)
      setExpandedDirectories(() => {
        const expanded = defaultExpandedDirectories(fresh.changed.map((file) => file.path))
        return selected === undefined ? expanded : expandAncestorsForPath(expanded, selected)
      })
      setFullContentPaths(new Set())
      setFileView(false)
      setJumpTarget(undefined)
      setProblemIndex(0)
      setActivityLog(emptyActivityLog)
      setFocusedPane("tree")
      setStatus(`worktree: ${worktreeLabel(worktree)}`)
      void runChecksRef.current(fresh)
    } catch (error) {
      setStatus(error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error))
    }
  }

  const handlePaletteInput = useCallback((value: string) => {
    setPaletteQuery(value)
    setPaletteIndex(0)
  }, [])

  const pickPaletteResult = useCallback(() => {
    const path = paletteResults[paletteIndex]
    if (path !== undefined) {
      selectFile(path)
      setFocusedPane("diff")
    }
    setPaletteOpen(false)
  }, [paletteResults, paletteIndex, selectFile])

  const sidebarWidth = sidebarOpen ? Math.max(34, Math.min(54, Math.floor(width * 0.34))) : 0
  const paletteWidth = Math.max(30, Math.min(70, width - 8))
  const paletteLeft = Math.max(0, Math.floor((width - paletteWidth) / 2))
  const cursorLine = navigableLines[cursorIndex]
  const cursorLineNumber = cursorLine?.newLine ?? cursorLine?.oldLine
  const cursorFindings = cursorLine?.newLine === undefined ? undefined : lineMap.get(cursorLine.newLine)
  const latest = latestActivity(activityLog)
  const activityText =
    latest === undefined || now - latest.at >= RECENT_MS ? "" : `${Math.max(0, Math.round((now - latest.at) / 1000))}s ago ${latest.path}`
  const displayStatus = checksInFlight > 0 ? "running checks…" : status
  const hints = "? keys · q quit"
  // The hints are navigation; the status is transient and yields on narrow terminals
  const statusRight = truncate(
    cursorFindings?.[0] !== undefined
      ? `${cursorFindings[0].checker}: ${cursorFindings[0].message}`
      : [activityText, truncated === true ? `${displayStatus} · truncated; f for full` : displayStatus]
          .filter((part) => part !== "")
          .join(" · "),
    Math.max(10, Math.min(width - 50, width - hints.length - 4)),
  )
  const countsText = `${counts.errors > 0 ? `✖${counts.errors}` : ""}${counts.warnings > 0 ? ` ⚠${counts.warnings}` : ""}`.trim()

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={theme.colors.surface.base}>
      <HeaderBar
        version={packageJson.version}
        repoRoot={model.repoRoot}
        scope={scope}
        changedCount={model.changed.length}
        countsText={countsText}
      />
      <box flexGrow={1} flexDirection="row">
        {sidebarOpen && (
          <Sidebar
            sidebarRef={sidebarRef}
            sidebarWidth={sidebarWidth}
            paneHeight={paneHeight}
            focused={focusedPane === "tree"}
            treeRows={treeRows}
            focusedRowIndex={focusedRowIndex}
            selectedPath={selectedPath}
            expandedDirectories={expandedDirectories}
            checkerState={checkerState}
            recencyByPath={recencyByPath}
            now={now}
          />
        )}
        <Viewer
          diffRef={diffRef}
          focused={focusedPane === "diff"}
          viewerHeight={viewerHeight}
          selectedPath={selectedPath}
          selectedFile={selectedFile}
          showFileContent={showFileContent}
          fileContent={fileContent}
          cursorLineNumber={cursorLineNumber}
          diff={renderedPatch.diff}
          fullContent={selectedPath !== undefined && fullContentPaths.has(selectedPath)}
          syntax={syntax}
        />
      </box>
      {problemsOpen ? (
        <ProblemsPanel
          problemsRef={problemsRef}
          allProblemItems={allProblemItems}
          problemIndex={problemIndex}
          focused={focusedPane === "problems"}
        />
      ) : null}
      <StatusBar hints={hints} statusRight={statusRight} />
      {paletteOpen ? (
        <Palette
          paletteRef={paletteRef}
          paletteLeft={paletteLeft}
          paletteWidth={paletteWidth}
          paletteResults={paletteResults}
          paletteIndex={paletteIndex}
          changedByPath={model.changedByPath}
          recencyByPath={recencyByPath}
          now={now}
          onInput={handlePaletteInput}
          onSubmit={pickPaletteResult}
        />
      ) : null}
      {worktreeOpen ? (
        <WorktreePicker
          worktreeRef={worktreeRef}
          paletteLeft={paletteLeft}
          paletteWidth={paletteWidth}
          worktrees={worktrees}
          worktreeIndex={worktreeIndex}
          repoRoot={model.repoRoot}
        />
      ) : null}
      {helpOpen ? <HelpOverlay paletteLeft={paletteLeft} paletteWidth={paletteWidth} height={height} /> : null}
    </box>
  )
}
