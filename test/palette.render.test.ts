import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
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

describe("go-to-file palette", () => {
  test("opens with ctrl-p, swallows global keys, fuzzy-jumps on enter", async () => {
    const repoRoot = createPaletteFixtureRepo()
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

      mockInput.pressKey("p", { ctrl: true })
      const palette = await settleUntil("go-to-file palette", (frame) => frame.includes("go to file"))
      expect(palette).toContain("go to file")

      // q must feed the input and show "no matches", not quit the app
      await mockInput.typeText("qqqq")
      const afterTyping = await settleUntil("empty palette results", (frame) => frame.includes("sideye") && frame.includes("no matches"))
      expect(afterTyping).toContain("sideye")
      expect(afterTyping).toContain("no matches")

      for (let index = 0; index < 4; index += 1) {
        mockInput.pressBackspace()
      }
      await mockInput.typeText("treets")
      const afterSearch = await settleUntil("tree search result", (frame) => frame.includes("src/tree.ts"))
      expect(afterSearch).toContain("src/tree.ts")

      mockInput.pressEnter()
      const after = await settleUntil("selected tree file", (frame) => frame.includes("src/tree.ts ·") && !frame.includes("go to file"))
      expect(after).toContain("src/tree.ts ·")
      expect(after).not.toContain("go to file")
    } finally {
      renderer.destroy()
      rmSync(repoRoot, { recursive: true, force: true })
    }
  }, 20_000)
})

function createPaletteFixtureRepo() {
  const repoRoot = mkdtempSync(join(tmpdir(), "sideye-palette-"))
  mkdirSync(join(repoRoot, "src"))
  mkdirSync(join(repoRoot, "test"))
  writeFileSync(join(repoRoot, "README.md"), "# Fixture\n")
  writeFileSync(join(repoRoot, "src", "App.tsx"), "export function App() { return null }\n")
  writeFileSync(join(repoRoot, "src", "tree.ts"), "export const tree = true\n")
  writeFileSync(join(repoRoot, "test", "tree.test.ts"), "export const testTree = true\n")

  execFileSync("git", ["init"], { cwd: repoRoot, stdio: "ignore" })
  execFileSync("git", ["add", "."], { cwd: repoRoot, stdio: "ignore" })
  execFileSync("git", ["-c", "user.name=Sideye Test", "-c", "user.email=sideye-test@example.com", "commit", "-m", "fixture"], {
    cwd: repoRoot,
    stdio: "ignore",
  })

  return repoRoot
}
