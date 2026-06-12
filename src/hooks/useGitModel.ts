import { useEffect, useRef, useState } from "react"
import type { DiffScope } from "../cli"
import { loadChangedFiles, loadRepoFiles, mergeChanged, type ChangedFile, type GitModel } from "../git"

// Owns the live git model and the adaptive polling that keeps it fresh. The
// Activity refs are returned so the model-diff effect and worktree switch (both
// In App) can read and prime them without this hook owning that cross-cut logic.
export function useGitModel(initialModel: GitModel, scope: DiffScope) {
  const [model, setModel] = useState(initialModel)
  const previousChangedRef = useRef<ChangedFile[]>(initialModel.changed)
  const previousScopeKeyRef = useRef(initialModel.scopeKey)
  const lastChangeRef = useRef<number>(Date.now())
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
          setModel((previous) => (previous.repoRoot === repoRoot ? mergeChanged(previous, next) : previous))
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
          setModel((previous) =>
            previous.repoRoot !== repoRoot || previous.repoFilesKey === next.repoFilesKey
              ? previous
              : { ...previous, repoFiles: next.repoFiles, repoFilesKey: next.repoFilesKey },
          )
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
  }, [repoRoot, scope])

  return { lastChangeRef, model, previousChangedRef, previousScopeKeyRef, setModel }
}
