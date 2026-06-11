import { describe, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  allFindings,
  checkerFailures,
  checkerSummary,
  countBySeverity,
  findingsLineMap,
  initialCheckerState,
  parseLintOutput,
  parsePrettierList,
  parseTypeScriptOutput,
  runDiagnostics,
  stateForResolvedChecker,
  type CheckerState,
  type Diagnostic,
} from "../src/diagnostics"
import type { ChangedFile } from "../src/git"

const file: ChangedFile = {
  path: "src/a.ts",
  kind: "modified",
  stage: "unstaged",
  additions: 1,
  deletions: 0,
  binary: false,
  warnings: [],
  mtimeMs: 0,
}

function diagnostic(overrides: Partial<Diagnostic>): Diagnostic {
  return { checker: "typecheck", path: "src/a.ts", line: 3, severity: "error", message: "nope", ...overrides }
}

function stateWith(diagnostics: Diagnostic[]): CheckerState {
  return {
    ...initialCheckerState([file]),
    typecheck: stateForResolvedChecker("typecheck", [file], diagnostics, "/repo"),
  }
}

describe("initialCheckerState", () => {
  test("starts every checker as pending", () => {
    const state = initialCheckerState([file])
    expect(state.lint.get("src/a.ts")?.status).toBe("pending")
    expect(state.prettier.get("src/a.ts")?.status).toBe("pending")
    expect(state.typecheck.get("src/a.ts")?.status).toBe("pending")
  })
})

describe("stateForResolvedChecker", () => {
  test("retains findings for files outside the changed set", () => {
    const state = stateForResolvedChecker("typecheck", [file], [diagnostic({ path: "/repo/src/unchanged.ts" })], "/repo")

    expect(state.get("src/unchanged.ts")?.status).toBe("findings")
    expect(state.get("src/unchanged.ts")?.diagnostics[0]?.path).toBe("src/unchanged.ts")
    expect(state.get("src/a.ts")?.status).toBe("clean")
  })
})

describe("problem helpers", () => {
  test("allFindings sorts by severity, path, then line", () => {
    const state = stateWith([
      diagnostic({ path: "/repo/src/b.ts", severity: "warning", line: 1 }),
      diagnostic({ path: "/repo/src/b.ts", severity: "error", line: 9 }),
      diagnostic({ path: "/repo/src/a.ts", severity: "error", line: 2 }),
    ])

    expect(allFindings(state).map((finding) => `${finding.path}:${finding.line}`)).toEqual(["src/a.ts:2", "src/b.ts:9", "src/b.ts:1"])
  })

  test("countBySeverity tallies errors and warnings", () => {
    const state = stateWith([diagnostic({}), diagnostic({ line: 5 }), diagnostic({ severity: "warning", line: 7 })])
    expect(countBySeverity(allFindings(state))).toEqual({ errors: 2, warnings: 1 })
  })

  test("checkerSummary tallies a single path and tracks pending", () => {
    const state = stateWith([diagnostic({}), diagnostic({ path: "/repo/src/other.ts" })])
    // lint and prettier are still pending in stateWith; typecheck resolved
    expect(checkerSummary("src/a.ts", state)).toEqual({ pending: true, failed: false, errors: 1, warnings: 0 })
  })

  test("checkerSummary and checkerFailures surface failed runs", () => {
    const state: CheckerState = {
      ...initialCheckerState([file]),
      lint: new Map([["src/a.ts", { status: "failed", count: 0, diagnostics: [], message: "boom\ndetail" }]]),
    }
    expect(checkerSummary("src/a.ts", state).failed).toBe(true)
    expect(checkerFailures(state)).toEqual([{ checker: "lint", message: "boom\ndetail" }])
  })

  test("findingsLineMap groups by line number", () => {
    const state = stateWith([diagnostic({}), diagnostic({ message: "again" }), diagnostic({ line: undefined, message: "no line" })])
    const byLine = findingsLineMap("src/a.ts", state)

    expect(byLine.get(3)?.map((finding) => finding.message)).toEqual(["nope", "again"])
    expect(byLine.size).toBe(1)
  })
})

describe("diagnostic parsers", () => {
  test("parses eslint json", () => {
    const diagnostics = parseLintOutput({
      stdout: JSON.stringify([{ filePath: "src/a.ts", messages: [{ line: 3, severity: 2, message: "bad" }] }]),
      stderr: "",
      exitCode: 1,
    })
    expect(diagnostics).toEqual([{ checker: "lint", path: "src/a.ts", line: 3, severity: "error", message: "bad" }])
  })

  test("parses oxlint json", () => {
    const diagnostics = parseLintOutput({
      stdout: JSON.stringify({
        diagnostics: [{ filename: "src/a.ts", message: "bad", severity: "warning", labels: [{ span: { line: 7 } }] }],
      }),
      stderr: "",
      exitCode: 1,
    })
    expect(diagnostics).toEqual([{ checker: "lint", path: "src/a.ts", line: 7, severity: "warning", message: "bad" }])
  })

  test("treats unparseable lint output with exit 0 as clean", () => {
    expect(parseLintOutput({ stdout: "Found 0 warnings and 0 errors.\n", stderr: "", exitCode: 0 })).toEqual([])
  })

  test("treats unparseable lint output with exit 1 as findings, not failure", () => {
    expect(parseLintOutput({ stdout: "src/a.ts:1:1: error no-unused-vars\nmore", stderr: "", exitCode: 1 })).toEqual([
      { checker: "lint", path: "", severity: "error", message: "src/a.ts:1:1: error no-unused-vars" },
    ])
  })

  test("parses prettier list output", () => {
    expect(parsePrettierList({ stdout: "Checking formatting...\nsrc/a.ts\n" })).toEqual([
      { checker: "prettier", path: "src/a.ts", severity: "warning", message: "Formatting differs from Prettier" },
    ])
  })

  test("parses TypeScript diagnostics", () => {
    expect(parseTypeScriptOutput({ stdout: "src/a.ts(4,12): error TS2322: nope", stderr: "" })).toEqual([
      { checker: "typecheck", path: "src/a.ts", line: 4, severity: "error", message: "nope" },
    ])
  })
})

describe("runDiagnostics", () => {
  async function lintStatuses(lintScript: string) {
    const dir = mkdtempSync(join(tmpdir(), "sideye-diagnostics-"))
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { lint: lintScript } }))
    const states = new Map<string, Map<string, { status: string }>>()
    await runDiagnostics(dir, [file], (checker, state) => {
      states.set(checker, state)
    })
    return states.get("lint")
  }

  test("unconfigured checkers resolve as unavailable instead of clean or failed", async () => {
    // deleted-only changes leave no paths to lint or format
    const deleted: ChangedFile = { ...file, kind: "deleted" }
    const states = new Map<string, string>()
    await runDiagnostics(mkdtempSync(join(tmpdir(), "sideye-diagnostics-")), [deleted], (checker, state) => {
      states.set(checker, state.get("src/a.ts")?.status ?? "missing")
    })
    expect(states.get("lint")).toBe("unavailable")
    expect(states.get("prettier")).toBe("unavailable")
  })

  test("a lint script that crashes resolves as failed", async () => {
    const lint = await lintStatuses("exit 2")
    expect(lint?.get("src/a.ts")?.status).toBe("failed")
  })

  test("a clean lint script with text output resolves as clean", async () => {
    const lint = await lintStatuses("echo Found 0 warnings && exit 0")
    expect(lint?.get("src/a.ts")?.status).toBe("clean")
  })

  test("a lint script with text findings resolves as findings, not failure", async () => {
    const lint = await lintStatuses("echo problems found && exit 1")
    expect(lint?.get("src/a.ts")?.status).toBe("clean")
    expect(lint?.get("")?.status).toBe("findings")
  })
})
