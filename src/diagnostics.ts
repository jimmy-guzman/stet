import { existsSync, readFileSync } from "node:fs"
import type { ChangedFile } from "./git"
import { runCommandAsync } from "./process"

export type CheckerName = "typecheck" | "lint" | "prettier"
export type CheckerStatus = "pending" | "clean" | "findings" | "failed"

export type Diagnostic = {
  checker: CheckerName
  path: string
  line?: number
  severity: "error" | "warning" | "info"
  message: string
}

export type CheckerFileState = {
  status: CheckerStatus
  count: number
  diagnostics: Diagnostic[]
  message?: string
}

export type CheckerState = Record<CheckerName, Map<string, CheckerFileState>>

type PackageJson = { scripts?: Record<string, string> }

type CheckerCommand = {
  checker: CheckerName
  command?: string[]
  parser: (result: { stdout: string; stderr: string; exitCode?: number }) => Diagnostic[]
  allowedExitCodes: number[]
  unavailableMessage?: string
}

const checkerNames: CheckerName[] = ["lint", "prettier", "typecheck"]

export function initialCheckerState(files: ChangedFile[]): CheckerState {
  return {
    lint: initialFileState(files),
    prettier: initialFileState(files),
    typecheck: initialFileState(files),
  }
}

export function markPending(state: CheckerState, files: ChangedFile[], changedPaths: string[]): CheckerState {
  const changed = new Set(changedPaths)
  const next = {} as CheckerState
  for (const checker of checkerNames) {
    const map = new Map(state[checker])
    for (const file of files) {
      if (map.get(file.path) === undefined || changed.has(file.path)) {
        map.set(file.path, { status: "pending", count: 0, diagnostics: [] })
      }
    }
    next[checker] = map
  }

  return next
}

export function summarizeBadges(path: string, state: CheckerState) {
  return checkerNames.map((checker) => {
    const fileState = state[checker].get(path)
    if (fileState === undefined) {
      return `${checker}:?`
    }

    if (fileState.status === "pending") {
      return `${shortChecker(checker)}:...`
    }

    if (fileState.status === "clean") {
      return `${shortChecker(checker)}:ok`
    }

    if (fileState.status === "failed") {
      return `${shortChecker(checker)}:fail`
    }

    return `${shortChecker(checker)}:${fileState.count}`
  })
}

export function fileHasFindings(path: string, state: CheckerState) {
  return checkerNames.some((checker) => state[checker].get(path)?.status === "findings")
}

const severityRank = { error: 0, warning: 1, info: 2 } as const

export function allFindings(state: CheckerState): Diagnostic[] {
  const findings: Diagnostic[] = []
  for (const checker of checkerNames) {
    for (const fileState of state[checker].values()) {
      findings.push(...fileState.diagnostics)
    }
  }

  return findings.toSorted(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      a.path.localeCompare(b.path) ||
      (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER),
  )
}

export function globalCounts(state: CheckerState) {
  let errors = 0
  let warnings = 0
  for (const checker of checkerNames) {
    for (const fileState of state[checker].values()) {
      for (const diagnostic of fileState.diagnostics) {
        if (diagnostic.severity === "error") {
          errors += 1
        } else {
          warnings += 1
        }
      }
    }
  }

  return { errors, warnings }
}

export function problemCounts(path: string, state: CheckerState) {
  let errors = 0
  let warnings = 0
  for (const checker of checkerNames) {
    for (const diagnostic of state[checker].get(path)?.diagnostics ?? []) {
      if (diagnostic.severity === "error") {
        errors += 1
      } else {
        warnings += 1
      }
    }
  }

  return { errors, warnings }
}

export function findingsLineMap(path: string, state: CheckerState) {
  const byLine = new Map<number, Diagnostic[]>()
  for (const checker of checkerNames) {
    for (const diagnostic of state[checker].get(path)?.diagnostics ?? []) {
      if (diagnostic.line === undefined) {
        continue
      }

      const existing = byLine.get(diagnostic.line)
      if (existing === undefined) {
        byLine.set(diagnostic.line, [diagnostic])
      } else {
        existing.push(diagnostic)
      }
    }
  }

  return byLine
}

export async function runDiagnostics(
  repoRoot: string,
  files: ChangedFile[],
  onCheckerDone: (checker: CheckerName, state: Map<string, CheckerFileState>) => void,
) {
  const commands = discoverCheckerCommands(repoRoot, files)
  await Promise.all(
    commands.map(async (command) => {
      try {
        if (command.command === undefined) {
          onCheckerDone(command.checker, stateForFailedChecker(files, command.unavailableMessage ?? `${command.checker} is not configured`))
          return
        }

        const result = await runCommandAsync(command.command, repoRoot, command.allowedExitCodes)
        const diagnostics = command.parser(result)
        onCheckerDone(command.checker, stateForResolvedChecker(command.checker, files, diagnostics, repoRoot))
      } catch (error) {
        onCheckerDone(command.checker, stateForFailedChecker(files, error instanceof Error ? error.message : String(error)))
      }
    }),
  )
}

export function discoverCheckerCommands(repoRoot: string, files: ChangedFile[]): CheckerCommand[] {
  const packageJson = readPackageJson(repoRoot)
  const changedPaths = files.filter((file) => file.kind !== "deleted").map((file) => file.path)

  return [
    lintCommand(repoRoot, packageJson, changedPaths),
    prettierCommand(repoRoot, changedPaths),
    typecheckCommand(repoRoot, packageJson),
  ]
}

function lintCommand(repoRoot: string, packageJson: PackageJson | undefined, changedPaths: string[]): CheckerCommand {
  if (packageJson?.scripts?.lint !== undefined) {
    return { checker: "lint", command: ["bun", "run", "lint"], parser: parseEslintJsonOrText("lint"), allowedExitCodes: [0, 1] }
  }

  if (changedPaths.length === 0) {
    return unconfiguredChecker("lint")
  }

  if (hasBinary(repoRoot, "oxlint")) {
    return {
      checker: "lint",
      command: ["bunx", "oxlint", "--format", "json", ...changedPaths],
      parser: parseOxlintJson,
      allowedExitCodes: [0, 1],
    }
  }

  if (hasBinary(repoRoot, "eslint")) {
    return {
      checker: "lint",
      command: ["bunx", "eslint", "--format", "json", ...changedPaths],
      parser: parseEslintJson,
      allowedExitCodes: [0, 1],
    }
  }

  return unconfiguredChecker("lint")
}

function prettierCommand(repoRoot: string, changedPaths: string[]): CheckerCommand {
  if (changedPaths.length === 0 || !hasBinary(repoRoot, "prettier")) {
    return unconfiguredChecker("prettier")
  }

  return {
    checker: "prettier",
    command: ["bunx", "prettier", "--list-different", ...changedPaths],
    parser: parsePrettierList,
    allowedExitCodes: [0, 1],
  }
}

function typecheckCommand(repoRoot: string, packageJson: PackageJson | undefined): CheckerCommand {
  if (packageJson?.scripts?.typecheck !== undefined) {
    return { checker: "typecheck", command: ["bun", "run", "typecheck"], parser: parseTypeScriptOutput, allowedExitCodes: [0, 1, 2] }
  }

  if (hasBinary(repoRoot, "tsc")) {
    return { checker: "typecheck", command: ["bunx", "tsc", "--noEmit"], parser: parseTypeScriptOutput, allowedExitCodes: [0, 1, 2] }
  }

  return unconfiguredChecker("typecheck")
}

export function parseEslintJson(output: { stdout: string }): Diagnostic[] {
  if (output.stdout.trim() === "") {
    return []
  }

  const parsed = JSON.parse(output.stdout) as Array<{
    filePath: string
    messages: Array<{ line?: number; severity?: number; message: string }>
  }>

  return parsed.flatMap((file) =>
    file.messages.map((message) => ({
      checker: "lint" as const,
      path: file.filePath,
      line: message.line,
      severity: message.severity === 2 ? ("error" as const) : ("warning" as const),
      message: message.message,
    })),
  )
}

export function parseOxlintJson(output: { stdout: string }): Diagnostic[] {
  if (output.stdout.trim() === "") {
    return []
  }

  const parsed = JSON.parse(output.stdout) as {
    diagnostics?: Array<{ filename?: string; message?: string; labels?: Array<{ span?: { line?: number } }> }>
  }
  return (parsed.diagnostics ?? []).map((diagnostic) => ({
    checker: "lint" as const,
    path: diagnostic.filename ?? "",
    line: diagnostic.labels?.[0]?.span?.line,
    severity: "error" as const,
    message: diagnostic.message ?? "oxlint finding",
  }))
}

export function parsePrettierList(output: { stdout: string }): Diagnostic[] {
  return output.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("Checking formatting") && !line.startsWith("All matched files"))
    .map((path) => ({
      checker: "prettier" as const,
      path,
      severity: "warning" as const,
      message: "Formatting differs from Prettier",
    }))
}

export function parseTypeScriptOutput(output: { stdout: string; stderr: string }): Diagnostic[] {
  const diagnostics = `${output.stdout}\n${output.stderr}`.split("\n").flatMap((line) => {
    const match = line.match(/^(.+?)\((\d+),(\d+)\):\s+error\s+TS\d+:\s+(.+)$/)
    if (match === null) {
      return []
    }

    return [
      {
        checker: "typecheck" as const,
        path: match[1],
        line: Number.parseInt(match[2], 10),
        severity: "error" as const,
        message: match[4],
      },
    ]
  })

  if (diagnostics.length === 0 && "exitCode" in output && output.exitCode !== undefined && output.exitCode !== 0) {
    const text = `${output.stdout}\n${output.stderr}`.trim()
    throw new Error(text === "" ? "typecheck failed without parseable diagnostics" : text.split("\n")[0])
  }

  return diagnostics
}

function parseEslintJsonOrText(checker: CheckerName) {
  return (output: { stdout: string; stderr: string }) => {
    try {
      return parseEslintJson(output)
    } catch {
      const text = `${output.stdout}\n${output.stderr}`.trim()
      if (text === "") {
        return []
      }

      throw new Error(text.split("\n")[0] ?? `${checker} failed without parseable diagnostics`)
    }
  }
}

export function stateForResolvedChecker(checker: CheckerName, files: ChangedFile[], diagnostics: Diagnostic[], repoRoot: string) {
  const byPath = new Map<string, Diagnostic[]>()
  for (const diagnostic of diagnostics) {
    const path = relativize(diagnostic.path, repoRoot)
    const existing = byPath.get(path)
    const normalized = { ...diagnostic, path, checker }
    if (existing === undefined) {
      byPath.set(path, [normalized])
    } else {
      existing.push(normalized)
    }
  }

  // keep findings for every reported path (tsc runs project-wide), not just changed files
  const state = new Map<string, CheckerFileState>()
  for (const [path, fileDiagnostics] of byPath) {
    state.set(path, { status: "findings", count: fileDiagnostics.length, diagnostics: fileDiagnostics })
  }

  for (const file of files) {
    if (!state.has(file.path)) {
      state.set(file.path, { status: "clean", count: 0, diagnostics: [] })
    }
  }

  return state
}

function stateForFailedChecker(files: ChangedFile[], message: string) {
  return new Map(
    files.map((file) => [
      file.path,
      {
        status: "failed" as const,
        count: 0,
        diagnostics: [],
        message,
      },
    ]),
  )
}

function unconfiguredChecker(checker: CheckerName): CheckerCommand {
  return {
    checker,
    parser: () => [],
    allowedExitCodes: [0],
    unavailableMessage: `${checker} is not configured`,
  }
}

function shortChecker(checker: CheckerName) {
  if (checker === "typecheck") {
    return "ts"
  }

  if (checker === "prettier") {
    return "fmt"
  }

  return "lint"
}

function initialFileState(files: ChangedFile[]) {
  return new Map(
    files.map((file) => [
      file.path,
      {
        status: "pending" as const,
        count: 0,
        diagnostics: [],
      },
    ]),
  )
}

function readPackageJson(repoRoot: string): PackageJson | undefined {
  const path = `${repoRoot}/package.json`
  if (!existsSync(path)) {
    return undefined
  }

  return JSON.parse(readFileSync(path, "utf8")) as PackageJson
}

function hasBinary(repoRoot: string, binary: string) {
  return existsSync(`${repoRoot}/node_modules/.bin/${binary}`) || Bun.which(binary) !== null
}

function relativize(path: string, repoRoot: string) {
  const prefix = repoRoot.endsWith("/") ? repoRoot : `${repoRoot}/`
  return (path.startsWith(prefix) ? path.slice(prefix.length) : path).replace(/^\.\//, "")
}
