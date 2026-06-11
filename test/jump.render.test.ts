import { rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { createRoot } from "@opentui/react"
import { createElement } from "react"
import { App } from "../src/App"
import { loadGitModel } from "../src/git"
import { createFixtureRepo, disabledSyntax, makeSettleUntil } from "../test/helpers"

describe("view toggle jumps", () => {
  test("v returns to the diff even from a line outside every hunk", async () => {
    const lines = Array.from({ length: 30 }, (_, index) => `const line${index + 1} = ${index + 1}`)
    // pin the checkers so binaries on the runner's PATH cannot lint the fixture
    const repoRoot = createFixtureRepo("sideye-jump-", {
      "package.json": `${JSON.stringify({ scripts: { lint: "exit 0", typecheck: "exit 0" } })}\n`,
      "src/a.ts": `${lines.join("\n")}\n`,
    })
    writeFileSync(join(repoRoot, "src", "a.ts"), `${["const line1 = 1", "const changed = true", ...lines.slice(2)].join("\n")}\n`)

    const model = await loadGitModel(repoRoot, { kind: "all", ref: "HEAD" })
    const { renderer, renderOnce, captureCharFrame, mockInput } = await createTestRenderer({ width: 120, height: 34 })
    const settleUntil = makeSettleUntil({ renderOnce, captureCharFrame })

    try {
      createRoot(renderer).render(createElement(App, { model, scope: { kind: "all", ref: "HEAD" }, syntax: disabledSyntax }))
      await settleUntil("diff view", (frame) => frame.includes("diff · ln"), 5)

      // focus the viewer, switch to file view, and move far away from the hunk
      mockInput.pressTab()
      mockInput.pressKey("v")
      await settleUntil("file view", (frame) => frame.includes("file · ln"))
      // plain j presses: ctrl-d (0x04) is not delivered on every platform
      for (let press = 0; press < lines.length; press += 1) {
        mockInput.pressKey("j")
      }
      await settleUntil("cursor at end of file", (frame) => frame.includes("file · ln 30"))

      // toggling back must land on the nearest hunk line, not bounce to file view
      mockInput.pressKey("v")
      const after = await settleUntil("diff view again", (frame) => frame.includes("diff · ln"))
      expect(after).not.toContain("file · ln")
    } finally {
      renderer.destroy()
      rmSync(repoRoot, { recursive: true, force: true })
    }
  }, 20_000)
})
