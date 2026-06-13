import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "bun:test"
import { Effect, Stream } from "effect"
import { loadGitModel } from "../src/git"
import { Diagnostics, DiagnosticsLive } from "../src/services/diagnostics"
import { createFixtureRepo } from "./helpers"

test("Diagnostics.run streams a state for each configured checker", async () => {
  const repo = createFixtureRepo("diag-service-", {
    "a.ts": "const a = 1\n",
    "package.json": `${JSON.stringify({ scripts: { lint: "exit 0", typecheck: "exit 0" } })}\n`,
  })
  writeFileSync(join(repo, "a.ts"), "const a = 2\n")
  const model = await loadGitModel(repo, { kind: "all", ref: "HEAD" })

  const updates = await Effect.runPromise(
    Diagnostics.pipe(
      Effect.flatMap((diagnostics) => Stream.runCollect(diagnostics.run(repo, model.changed))),
      Effect.provide(DiagnosticsLive),
    ),
  )

  const checkers = [...updates].map((update) => update.checker)
  expect(checkers).toContain("lint")
  expect(checkers).toContain("typecheck")
})
