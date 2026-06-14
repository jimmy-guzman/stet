import { rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { App } from "../src/App"
import { state } from "../src/state"
import { createFixtureRepo, loadModel, makeSettleUntil, seedState } from "./helpers"

describe("scope switching", () => {
  test("re-runs checks for the new scope's changed set", async () => {
    // The lint script crashes, so the initial run must surface an explicit failure
    const repoRoot = createFixtureRepo("sideye-scope-", {
      "package.json": `${JSON.stringify({ scripts: { lint: "exit 2", typecheck: "exit 0" } })}\n`,
      "src/a.ts": "const a = 1\n",
    })
    writeFileSync(join(repoRoot, "src", "a.ts"), "const a = 2\n")

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" })
    seedState(model, { kind: "all", ref: "HEAD" })
    const { renderer, renderOnce, captureCharFrame, mockInput } = await testRender(() => <App />, { height: 34, width: 120 })
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce })

    try {
      // Main runs the initial checks at startup; mirror that here
      void state.runChecks(model)
      const failed = await settleUntil("failed lint run", (frame) => frame.includes("lint failed:"), 5)
      expect(failed).toContain("fail")

      // The staged scope has no changes, so a re-run finishes without failures;
      // That status can only appear if the scope switch re-ran checks
      mockInput.pressKey("s")
      const after = await settleUntil("recheck after scope switch", (frame) => frame.includes("checks finished"))
      expect(after).toContain("staged vs HEAD")
      expect(after).not.toContain("lint failed:")
    } finally {
      renderer.destroy()
      rmSync(repoRoot, { force: true, recursive: true })
    }
  }, 20_000)
})
