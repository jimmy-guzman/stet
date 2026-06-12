import { useEffect, useMemo, useRef, useState } from "react"
import type { ActivityLog } from "../activity"
import {
  allFindings,
  checkerNames,
  countBySeverity,
  initialCheckerState,
  runDiagnostics,
  type CheckerName,
  type CheckerState,
  type Diagnostic,
} from "../diagnostics"
import type { GitModel } from "../git"

export type ProblemItem =
  | { kind: "failure"; id: string; checker: CheckerName; line: string; isFirst: boolean }
  | { kind: "problem"; id: string; problem: Diagnostic }

// Owns the checker lifecycle: running diagnostics, tracking in-flight runs, and
// Deriving the problem list. runChecks redefines each render to close over the
// Freshest model; runChecksRef lets effects and callers reach the latest closure.
export function useDiagnostics(model: GitModel, activityLog: ActivityLog, initialStatus: string) {
  const [checkerState, setCheckerState] = useState<CheckerState>(() => initialCheckerState(model.changed))
  const [status, setStatus] = useState(initialStatus)
  const [checksInFlight, setChecksInFlight] = useState(0)
  const runGenerationRef = useRef(0)
  const abortRef = useRef<AbortController | undefined>(undefined)

  function runChecks(target: GitModel = model) {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const generation = runGenerationRef.current + 1
    runGenerationRef.current = generation

    setCheckerState(initialCheckerState(target.changed))
    setChecksInFlight((count) => count + 1)
    const failures: string[] = []
    return runDiagnostics(
      target.repoRoot,
      target.changed,
      (checker, nextState) => {
        // A newer run owns the state; drop results arriving from a stale run
        if (generation !== runGenerationRef.current) {
          return
        }

        setCheckerState((current) => ({ ...current, [checker]: nextState }))
        for (const fileState of nextState.values()) {
          if (fileState.status === "failed") {
            // A failed run stamps every file with the same run-level message
            failures.push(`${checker} failed: ${fileState.message?.split("\n")[0] ?? ""}`)
            break
          }
        }
      },
      controller.signal,
    ).finally(() => {
      setChecksInFlight((count) => Math.max(0, count - 1))
      // The run reports its own completion: every trigger path (mount, the r
      // Key, the quiet-period rerun) gets a status, and only the latest run speaks
      if (generation === runGenerationRef.current) {
        setStatus(failures[0] ?? "checks finished")
      }
    })
  }

  const runChecksRef = useRef(runChecks)
  runChecksRef.current = runChecks

  useEffect(() => {
    runChecksRef.current()
    return () => abortRef.current?.abort()
  }, [])

  useEffect(() => {
    if (activityLog.events.length === 0) {
      return
    }

    // Checks re-run once the repo has been quiet for 2s
    const id = setTimeout(() => runChecksRef.current(), 2000)
    return () => clearTimeout(id)
  }, [activityLog])

  const problems = useMemo(() => allFindings(checkerState), [checkerState])
  const counts = useMemo(() => countBySeverity(problems), [problems])
  const checkerFailures = useMemo(
    () =>
      checkerNames.flatMap((checker) => {
        for (const [, fileState] of checkerState[checker]) {
          if (fileState.status === "failed" && fileState.message !== undefined) {
            return [{ checker, message: fileState.message }]
          }
        }
        return []
      }),
    [checkerState],
  )
  const allProblemItems = useMemo(() => {
    const items: ProblemItem[] = []
    checkerFailures.forEach(({ checker, message }, fi) => {
      message
        .split("\n")
        .filter((l) => l.trim() !== "")
        .forEach((line, li) => {
          items.push({ checker, id: `failure-${fi}-${li}`, isFirst: li === 0, kind: "failure", line })
        })
    })
    problems.forEach((problem, index) => {
      items.push({ id: `problem-${index}`, kind: "problem", problem })
    })
    return items
  }, [checkerFailures, problems])

  return {
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
  }
}
