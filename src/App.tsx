import { existsSync } from "node:fs"
import packageJson from "../package.json"
import { useAtomInitialValues, useAtomSet, useAtomValue } from "@effect/atom-react"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { useCallback, useEffect, useMemo, useRef } from "react"
import { emptyActivityLog, latestActivity, recordActivity, RECENT_MS } from "./activity"
import { activityLogAtom, nowAtom, recencyByPathAtom } from "./atoms/activity"
import { gitModelAtom } from "./atoms/git"
import { focusedRowIndexAtom, treeRowsAtom } from "./atoms/tree"
import {
  changesOnlyAtom,
  expandedDirectoriesAtom,
  fileViewAtom,
  focusedNodeIdAtom,
  focusedPaneAtom,
  fullContentPathsAtom,
  helpOpenAtom,
  paletteIndexAtom,
  paletteOpenAtom,
  paletteQueryAtom,
  problemIndexAtom,
  problemsOpenAtom,
  scopeAtom,
  selectedPathAtom,
  sidebarOpenAtom,
  worktreeIndexAtom,
  worktreeOpenAtom,
  worktreesAtom,
} from "./atoms/ui"
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
import type { ChangedFile, GitModel, Worktree } from "./git"
import { loadChangedFiles, loadFileDiff, loadGitModel, loadRepoFiles, mergeChanged } from "./git"
import { useDiagnostics } from "./hooks/useDiagnostics"
import { useDiffCursor } from "./hooks/useDiffCursor"
import { createKeyHandler } from "./keymap"
import { renderPatch } from "./patch"
import type { SyntaxConfig } from "./syntax"
import { useTheme } from "./theme/context"
import { defaultExpandedDirectories, expandAncestorsForPath } from "./tree"
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

  const initialSelectedPath = initialModel.changed[0]?.path ?? initialModel.repoFiles[0]?.path
  const baseExpanded = defaultExpandedDirectories(initialModel.changed.map((file) => file.path))
  const initialExpanded = initialSelectedPath === undefined ? baseExpanded : expandAncestorsForPath(baseExpanded, initialSelectedPath)
  useAtomInitialValues([
    [gitModelAtom, initialModel],
    [scopeAtom, initialScope],
    [selectedPathAtom, initialSelectedPath],
    [focusedNodeIdAtom, initialSelectedPath === undefined ? "" : `file:${initialSelectedPath}`],
    [expandedDirectoriesAtom, initialExpanded],
  ])

  const scope = useAtomValue(scopeAtom)
  const setScope = useAtomSet(scopeAtom)
  const setGitModel = useAtomSet(gitModelAtom)
  const model = useAtomValue(gitModelAtom) ?? initialModel
  const previousChangedRef = useRef<ChangedFile[]>(initialModel.changed)
  const previousScopeKeyRef = useRef(initialModel.scopeKey)
  const lastChangeRef = useRef(Date.now())
  const setChangesOnly = useAtomSet(changesOnlyAtom)
  const selectedPath = useAtomValue(selectedPathAtom)
  const setSelectedPath = useAtomSet(selectedPathAtom)
  const focusedRowIndex = useAtomValue(focusedRowIndexAtom)
  const setFocusedRowIndex = useAtomSet(focusedRowIndexAtom)
  const setFocusedNodeId = useAtomSet(focusedNodeIdAtom)
  const expandedDirectories = useAtomValue(expandedDirectoriesAtom)
  const setExpandedDirectories = useAtomSet(expandedDirectoriesAtom)
  const fullContentPaths = useAtomValue(fullContentPathsAtom)
  const setFullContentPaths = useAtomSet(fullContentPathsAtom)
  const fileView = useAtomValue(fileViewAtom)
  const setFileView = useAtomSet(fileViewAtom)
  const focusedPane = useAtomValue(focusedPaneAtom)
  const setFocusedPane = useAtomSet(focusedPaneAtom)
  const problemsOpen = useAtomValue(problemsOpenAtom)
  const setProblemsOpen = useAtomSet(problemsOpenAtom)
  const sidebarOpen = useAtomValue(sidebarOpenAtom)
  const setSidebarOpen = useAtomSet(sidebarOpenAtom)
  const problemIndex = useAtomValue(problemIndexAtom)
  const setProblemIndex = useAtomSet(problemIndexAtom)
  const paletteOpen = useAtomValue(paletteOpenAtom)
  const setPaletteOpen = useAtomSet(paletteOpenAtom)
  const paletteQuery = useAtomValue(paletteQueryAtom)
  const setPaletteQuery = useAtomSet(paletteQueryAtom)
  const paletteIndex = useAtomValue(paletteIndexAtom)
  const setPaletteIndex = useAtomSet(paletteIndexAtom)
  const worktreeOpen = useAtomValue(worktreeOpenAtom)
  const setWorktreeOpen = useAtomSet(worktreeOpenAtom)
  const worktreeIndex = useAtomValue(worktreeIndexAtom)
  const setWorktreeIndex = useAtomSet(worktreeIndexAtom)
  const worktrees = useAtomValue(worktreesAtom)
  const setWorktrees = useAtomSet(worktreesAtom)
  const helpOpen = useAtomValue(helpOpenAtom)
  const setHelpOpen = useAtomSet(helpOpenAtom)
  const activityLog = useAtomValue(activityLogAtom)
  const setActivityLog = useAtomSet(activityLogAtom)
  const now = useAtomValue(nowAtom)
  const recencyByPath = useAtomValue(recencyByPathAtom)
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
  const treeRows = useAtomValue(treeRowsAtom)
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

  const repoRoot = model.repoRoot
  useEffect(() => {
    let cancelled = false
    let fastInFlight = false
    let slowInFlight = false

    async function loadFast() {
      if (fastInFlight) {
        return
      }
      fastInFlight = true
      try {
        const next = await loadChangedFiles(repoRoot, scope)
        if (!cancelled) {
          // A worktree switch may commit between this poll starting and landing
          setGitModel((previous) => {
            const base = previous ?? initialModel
            return base.repoRoot === repoRoot ? mergeChanged(base, next) : base
          })
        }
      } catch {
        // Transient git failures (e.g. an agent holding index.lock) resolve on the next poll
      } finally {
        fastInFlight = false
      }
    }

    async function loadSlow() {
      if (slowInFlight) {
        return
      }
      slowInFlight = true
      try {
        const next = await loadRepoFiles(repoRoot)
        if (!cancelled) {
          setGitModel((previous) => {
            const base = previous ?? initialModel
            return base.repoRoot !== repoRoot || base.repoFilesKey === next.repoFilesKey
              ? base
              : { ...base, repoFiles: next.repoFiles, repoFilesKey: next.repoFilesKey }
          })
        }
      } catch {
        // Ignore transient errors
      } finally {
        slowInFlight = false
      }
    }

    void loadFast()
    void loadSlow()

    // Adaptive fast poll: 750ms when active, 2000ms after 10s of quiet.
    let fastId: ReturnType<typeof setTimeout>
    function scheduleFast() {
      const quiet = Date.now() - lastChangeRef.current > 10_000
      fastId = setTimeout(
        () => {
          void loadFast()
          if (!cancelled) {
            scheduleFast()
          }
        },
        quiet ? 2000 : 750,
      )
    }
    scheduleFast()

    // Separate long interval just for the expensive tracked-files list.
    const slowId = setInterval(() => void loadSlow(), 5000)

    return () => {
      cancelled = true
      clearTimeout(fastId)
      clearInterval(slowId)
    }
  }, [repoRoot, scope, setGitModel, initialModel])

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

  const selectFile = useCallback(
    (path: string) => {
      setSelectedPath(path)
      setFocusedNodeId(`file:${path}`)
      setFileView(false)
      setExpandedDirectories((current) => expandAncestorsForPath(current, path))
    },
    [setSelectedPath, setFocusedNodeId, setFileView, setExpandedDirectories],
  )

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
      setGitModel(fresh)
      const selected = fresh.changed[0]?.path ?? fresh.repoFiles[0]?.path
      setSelectedPath(selected)
      setFocusedNodeId(selected === undefined ? "" : `file:${selected}`)
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

  const handlePaletteInput = useCallback(
    (value: string) => {
      setPaletteQuery(value)
      setPaletteIndex(0)
    },
    [setPaletteQuery, setPaletteIndex],
  )

  const pickPaletteResult = useCallback(() => {
    const path = paletteResults[paletteIndex]
    if (path !== undefined) {
      selectFile(path)
      setFocusedPane("diff")
    }
    setPaletteOpen(false)
  }, [paletteResults, paletteIndex, selectFile, setFocusedPane, setPaletteOpen])

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
