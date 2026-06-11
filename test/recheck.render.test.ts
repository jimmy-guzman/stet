import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { createRoot } from "@opentui/react"
import { createElement } from "react"
import { App } from "../src/App"
import { loadGitModel } from "../src/git"
import type { SyntaxConfig } from "../src/syntax"

const syntax: SyntaxConfig = { enabled: false, status: "syntax disabled for tests" }

describe("re-running checks", () => {
  test("r reports checks finished once diagnostics complete", async () => {
    const repoRoot = createFixtureRepo()
    const model = loadGitModel(repoRoot, { kind: "all", ref: "HEAD" })
    const { renderer, renderOnce, captureCharFrame, mockInput } = await createTestRenderer({ width: 120, height: 34 })

    const settleUntil = async (label: string, predicate: (frame: string) => boolean, minAttempts = 1) => {
      let frame = ""
      for (let attempt = 0; attempt < 100; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10))
        await renderOnce()
        frame = captureCharFrame()
        if (attempt + 1 >= minAttempts && predicate(frame)) {
          return frame
        }
      }

      throw new Error(`timed out waiting for ${label}\n\n${frame}`)
    }

    try {
      createRoot(renderer).render(createElement(App, { model, scope: { kind: "all", ref: "HEAD" }, syntax }))
      const initial = await settleUntil("app chrome", (frame) => frame.includes("sideye"), 5)
      expect(initial).toContain("sideye")

      mockInput.pressKey("r")
      const after = await settleUntil("re-run completion", (frame) => frame.includes("checks finished"))
      expect(after).toContain("checks finished")
      expect(after).not.toContain("re-running checks")
    } finally {
      renderer.destroy()
      rmSync(repoRoot, { recursive: true, force: true })
    }
  }, 20_000)
})

function createFixtureRepo() {
  const repoRoot = mkdtempSync(join(tmpdir(), "sideye-recheck-"))
  writeFileSync(join(repoRoot, "README.md"), "# Fixture\n")

  execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" })
  execFileSync("git", ["add", "."], { cwd: repoRoot, stdio: "ignore" })
  execFileSync("git", ["-c", "user.name=Sideye Test", "-c", "user.email=sideye-test@example.com", "commit", "-m", "fixture"], {
    cwd: repoRoot,
    stdio: "ignore",
  })

  return repoRoot
}
