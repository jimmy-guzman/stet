import { statSync } from "node:fs"
import type { DiffScope } from "./cli"
import { loadFileContent } from "./file-view"
import { runCommand, runCommandAsync } from "./process"

export type ChangeKind = "modified" | "added" | "deleted" | "renamed" | "untracked"

export type StageState = "staged" | "unstaged" | "mixed" | "untracked"

export type ChangedFile = {
  path: string
  oldPath?: string
  kind: ChangeKind
  stage: StageState
  additions: number
  deletions: number
  binary: boolean
  warnings: string[]
  // worktree mtime so edits that keep the churn counts identical still register
  mtimeMs: number
}

export type RepoFile = {
  path: string
  tracked: boolean
}

export type GitModel = {
  repoRoot: string
  scopeKey: string
  changed: ChangedFile[]
  changedByPath: Map<string, ChangedFile>
  repoFiles: RepoFile[]
  repoFilesKey: string
}

type StatusEntry = {
  path: string
  oldPath?: string
  kind: ChangeKind
}

export function resolveRepoRoot(cwd: string) {
  return runCommand(["git", "rev-parse", "--show-toplevel"], cwd).stdout.trim()
}

export async function loadGitModel(repoRoot: string, scope: DiffScope): Promise<GitModel> {
  const [tracked, untrackedFiles, nameStatusResult, numstatResult, porcelain] = await Promise.all([
    runCommandAsync(["git", "ls-files", "-z"], repoRoot),
    runCommandAsync(["git", "ls-files", "--others", "--exclude-standard", "-z"], repoRoot),
    runCommandAsync(nameStatusArgs(scope), repoRoot),
    runCommandAsync(numstatArgs(scope), repoRoot),
    runCommandAsync(["git", "status", "--porcelain=v1", "-z"], repoRoot),
  ])

  const trackedOutput = tracked.stdout
  const untrackedOutput = untrackedFiles.stdout
  const untracked = scope.kind === "staged" ? [] : parseUntrackedFiles(untrackedOutput)
  const nameStatus = parseNameStatus(nameStatusResult.stdout)
  const statusByPath = new Map([...nameStatus, ...untracked].map((entry) => [entry.path, entry]))
  const numstat = parseNumstat(numstatResult.stdout)
  const numstatByPath = new Map(numstat.map((entry) => [entry.path, entry]))
  const stageByPath = parsePorcelainStatus(porcelain.stdout)
  const paths = new Set([...numstatByPath.keys(), ...statusByPath.keys()])

  const changed = Array.from(paths)
    .map((path) => {
      const stat = numstatByPath.get(path)
      const statusEntry = statusByPath.get(path)
      const kind = statusEntry?.kind ?? inferKind(path, stat?.deletions ?? 0, stat?.additions ?? 0)
      const untrackedStat = kind === "untracked" && stat === undefined ? statUntrackedFile(repoRoot, path) : undefined
      const file: ChangedFile = {
        path,
        oldPath: statusEntry?.oldPath,
        kind,
        stage: stageByPath.get(path) ?? (kind === "untracked" ? "untracked" : "unstaged"),
        additions: stat?.additions ?? untrackedStat?.additions ?? 0,
        deletions: stat?.deletions ?? 0,
        binary: stat?.binary ?? untrackedStat?.binary ?? false,
        warnings: warningsFor(path, kind, stat?.additions ?? untrackedStat?.additions ?? 0, stat?.deletions ?? 0),
        mtimeMs: kind === "deleted" ? 0 : fileMtime(repoRoot, path),
      }
      return file
    })
    .toSorted((a, b) => a.path.localeCompare(b.path))

  const repoFilesKey = `${trackedOutput}\x01${untrackedOutput}`

  return {
    repoRoot,
    scopeKey: `${scope.kind}:${scope.ref}`,
    changed,
    changedByPath: new Map(changed.map((file) => [file.path, file])),
    repoFiles: parseRepoFiles(trackedOutput, untrackedOutput, repoFilesKey),
    repoFilesKey,
  }
}

export function loadFileDiff(repoRoot: string, scope: DiffScope, file: ChangedFile) {
  if (file.kind === "untracked") {
    return runCommand(["git", "diff", "--no-index", "--", "/dev/null", file.path], repoRoot, [0, 1]).stdout
  }

  // the old path must be in the pathspec or git cannot pair the rename and shows a whole-file add
  const pathspec = file.oldPath === undefined ? [file.path] : [file.oldPath, file.path]
  return runCommand([...diffArgs(scope), "--", ...pathspec], repoRoot, [0, 1]).stdout
}

export function numstatArgs(scope: DiffScope) {
  // -z keeps non-ASCII paths literal instead of core.quotePath's C-quoting
  return [...diffArgs(scope), "--numstat", "-z"]
}

export function nameStatusArgs(scope: DiffScope) {
  return [...diffArgs(scope), "--name-status", "-z"]
}

export function diffArgs(scope: DiffScope) {
  if (scope.kind === "staged") {
    return ["git", "diff", "--cached", scope.ref]
  }

  if (scope.kind === "unstaged") {
    return ["git", "diff"]
  }

  return ["git", "diff", scope.ref]
}

export function parsePorcelainStatus(output: string): Map<string, StageState> {
  const stageByPath = new Map<string, StageState>()
  const tokens = output.split("\0")

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === undefined || token.length < 4) {
      continue
    }

    const stage = stageFromCodes(token[0] ?? " ", token[1] ?? " ")
    stageByPath.set(token.slice(3), stage)

    if (token[0] === "R" || token[0] === "C" || token[1] === "R" || token[1] === "C") {
      const original = tokens[index + 1]
      if (original !== undefined && original !== "") {
        stageByPath.set(original, stage)
      }
      index += 1
    }
  }

  return stageByPath
}

export function mergeModel(prev: GitModel, next: GitModel): GitModel {
  if (
    prev.repoRoot === next.repoRoot &&
    prev.scopeKey === next.scopeKey &&
    prev.repoFilesKey === next.repoFilesKey &&
    changedSignature(prev.changed) === changedSignature(next.changed)
  ) {
    return prev
  }

  // keep identity for untouched files so per-file memos (e.g. the selected diff) hold
  const changed = next.changed.map((file) => {
    const before = prev.changedByPath.get(file.path)
    return before !== undefined && sameChangedFile(before, file) ? before : file
  })

  if (changed.every((file, index) => file === next.changed[index])) {
    return next
  }

  return { ...next, changed, changedByPath: new Map(changed.map((file) => [file.path, file])) }
}

function sameChangedFile(a: ChangedFile, b: ChangedFile) {
  return (
    a.path === b.path &&
    a.oldPath === b.oldPath &&
    a.kind === b.kind &&
    a.stage === b.stage &&
    a.additions === b.additions &&
    a.deletions === b.deletions &&
    a.binary === b.binary &&
    a.mtimeMs === b.mtimeMs
  )
}

function stageFromCodes(index: string, worktree: string): StageState {
  if (index === "?" && worktree === "?") {
    return "untracked"
  }

  const staged = index !== " " && index !== "?"
  const unstaged = worktree !== " " && worktree !== "?"
  if (staged && unstaged) {
    return "mixed"
  }

  return staged ? "staged" : "unstaged"
}

function changedSignature(files: ChangedFile[]) {
  return files
    .map((file) => `${file.path}\0${file.kind}\0${file.stage}\0${file.additions}\0${file.deletions}\0${file.mtimeMs}`)
    .join("\x01")
}

let repoFilesCache: { key: string; repoFiles: RepoFile[] } | undefined

function parseRepoFiles(trackedOutput: string, untrackedOutput: string, key: string): RepoFile[] {
  if (repoFilesCache?.key === key) {
    return repoFilesCache.repoFiles
  }

  const seen = new Set<string>()
  const repoFiles: RepoFile[] = []

  for (const path of trackedOutput.split("\0")) {
    if (path !== "" && !seen.has(path)) {
      seen.add(path)
      repoFiles.push({ path, tracked: true })
    }
  }

  for (const path of untrackedOutput.split("\0")) {
    if (path !== "" && !seen.has(path)) {
      seen.add(path)
      repoFiles.push({ path, tracked: false })
    }
  }

  repoFilesCache = { key, repoFiles }
  return repoFiles
}

export function parseUntrackedFiles(output: string): StatusEntry[] {
  return output
    .split("\0")
    .filter((path) => path !== "")
    .map((path) => ({ path, kind: "untracked" }))
}

export function parseNumstat(output: string) {
  const tokens = output.split("\0")
  const entries: Array<{ path: string; additions: number; deletions: number; binary: boolean }> = []

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === undefined || token === "") {
      continue
    }

    const [addedRaw = "0", deletedRaw = "0", ...pathParts] = token.split("\t")
    let path = pathParts.join("\t")
    if (token.endsWith("\t")) {
      // a rename record carries no inline path: "added\tdeleted\t" NUL old NUL new
      path = tokens[index + 2] ?? ""
      index += 2
    }

    const binary = addedRaw === "-" || deletedRaw === "-"
    entries.push({
      path,
      additions: binary ? 0 : Number.parseInt(addedRaw, 10),
      deletions: binary ? 0 : Number.parseInt(deletedRaw, 10),
      binary,
    })
  }

  return entries
}

export function parseNameStatus(output: string): StatusEntry[] {
  const tokens = output.split("\0")
  const entries: StatusEntry[] = []

  for (let index = 0; index < tokens.length; index += 1) {
    const status = tokens[index]
    if (status === undefined || status.trim() === "") {
      continue
    }

    const code = status[0]

    if (code === "R" || code === "C") {
      const oldPath = tokens[index + 1] ?? ""
      const path = tokens[index + 2] ?? oldPath
      index += 2
      // a copy leaves the source untouched, so only the destination is a change
      entries.push(code === "R" ? { path, oldPath, kind: "renamed" } : { path, kind: "added" })
      continue
    }

    const path = tokens[index + 1] ?? ""
    index += 1

    if (code === "A") {
      entries.push({ path, kind: "added" })
    } else if (code === "D") {
      entries.push({ path, kind: "deleted" })
    } else {
      entries.push({ path, kind: "modified" })
    }
  }

  return entries
}

function inferKind(path: string, deletions: number, additions: number): ChangeKind {
  if (deletions > 0 && additions === 0) {
    return "deleted"
  }

  if (additions > 0 && deletions === 0 && path !== "") {
    return "added"
  }

  return "modified"
}

function fileMtime(repoRoot: string, path: string) {
  try {
    return statSync(`${repoRoot}/${path}`).mtimeMs
  } catch {
    return 0
  }
}

function warningsFor(path: string, kind: ChangeKind, additions: number, deletions: number) {
  const warnings: string[] = []
  const filename = path.split("/").at(-1) ?? path

  if (kind === "deleted" || deletions > additions * 2) {
    warnings.push("deletions")
  }

  if (filename === "package.json" || filename.endsWith(".lock") || filename === "bun.lockb" || filename === "bun.lock") {
    warnings.push("deps")
  }

  if (additions + deletions > 500) {
    warnings.push("large")
  }

  if (kind === "untracked") {
    warnings.push("new")
  }

  return warnings
}

function statUntrackedFile(repoRoot: string, path: string) {
  // loadFileContent absorbs dangling symlinks and files deleted mid-scan as "missing"
  const content = loadFileContent(repoRoot, path, { full: false })
  if (content.kind === "text") {
    return { additions: content.lineCount, binary: false }
  }

  return { additions: 0, binary: content.kind !== "missing" }
}
