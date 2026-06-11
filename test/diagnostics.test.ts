import { describe, expect, test } from "bun:test"
import {
  allFindings,
  findingsLineMap,
  globalCounts,
  initialCheckerState,
  parseEslintJson,
  parsePrettierList,
  parseTypeScriptOutput,
  problemCounts,
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

  test("globalCounts tallies errors and warnings", () => {
    const state = stateWith([diagnostic({}), diagnostic({ line: 5 }), diagnostic({ severity: "warning", line: 7 })])
    expect(globalCounts(state)).toEqual({ errors: 2, warnings: 1 })
  })

  test("problemCounts tallies a single path", () => {
    const state = stateWith([diagnostic({}), diagnostic({ path: "/repo/src/other.ts" })])
    expect(problemCounts("src/a.ts", state)).toEqual({ errors: 1, warnings: 0 })
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
    const diagnostics = parseEslintJson({
      stdout: JSON.stringify([{ filePath: "src/a.ts", messages: [{ line: 3, severity: 2, message: "bad" }] }]),
    })
    expect(diagnostics).toEqual([{ checker: "lint", path: "src/a.ts", line: 3, severity: "error", message: "bad" }])
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
  test("missing checkers resolve as failed instead of clean", async () => {
    const states: string[] = []
    await runDiagnostics("/tmp", [file], (_checker, state) => {
      states.push(state.get("src/a.ts")?.status ?? "missing")
    })
    expect(states).toEqual(["failed", "failed", "failed"])
  })
})
