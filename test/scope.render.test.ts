import { rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { createRoot } from "@opentui/react"
import { createElement } from "react"
import { App } from "../src/App"
import { loadGitModel } from "../src/git"
import { createFixtureRepo, disabledSyntax, makeSettleUntil } from "../test/helpers"

describe("scope switching", () => {
  test("re-runs checks for the new scope's changed set", async () => {
    // the lint script crashes, so the initial run must surface an explicit failure
    const repoRoot = createFixtureRepo("sideye-scope-", {
      "package.json": `${JSON.stringify({ scripts: { lint: "exit 2", typecheck: "exit 0" } })}\n`,
      "src/a.ts": "const a = 1\n",
    })
    writeFileSync(join(repoRoot, "src", "a.ts"), "const a = 2\n")

    const model = await loadGitModel(repoRoot, { kind: "all", ref: "HEAD" })
    const { renderer, renderOnce, captureCharFrame, mockInput } = await createTestRenderer({ width: 120, height: 34 })
    const settleUntil = makeSettleUntil({ renderOnce, captureCharFrame })

    try {
      createRoot(renderer).render(createElement(App, { model, scope: { kind: "all", ref: "HEAD" }, syntax: disabledSyntax }))
      const failed = await settleUntil("failed lint run", (frame) => frame.includes("lint failed:"), 5)
      expect(failed).toContain("fail")

      // the staged scope has no changes, so a re-run finishes without failures;
      // that status can only appear if the scope switch re-ran checks
      mockInput.pressKey("s")
      const after = await settleUntil("recheck after scope switch", (frame) => frame.includes("checks finished"))
      expect(after).toContain("staged vs HEAD")
      expect(after).not.toContain("lint failed:")
    } finally {
      renderer.destroy()
      rmSync(repoRoot, { recursive: true, force: true })
    }
  }, 20_000)
})
