import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { expect, test } from "bun:test"
import { Effect } from "effect"
import { Git, GitLive } from "../src/services/git"
import { createFixtureRepo } from "./helpers"

const allScope = { kind: "all", ref: "HEAD" } as const

test("Git.loadModel reports a modified file with churn counts", async () => {
  const repo = createFixtureRepo("git-service-modified-", { "a.txt": "one\n" })
  writeFileSync(join(repo, "a.txt"), "one\ntwo\n")

  const model = await Effect.runPromise(
    Git.pipe(
      Effect.flatMap((git) => git.loadModel(repo, allScope)),
      Effect.provide(GitLive),
    ),
  )

  const file = model.changed.find((entry) => entry.path === "a.txt")
  expect(file?.kind).toBe("modified")
  expect(file?.additions).toBe(1)
})

test("Git.changedFiles includes an untracked file", async () => {
  const repo = createFixtureRepo("git-service-untracked-", { "tracked.txt": "x\n" })
  writeFileSync(join(repo, "new.txt"), "fresh\n")

  const result = await Effect.runPromise(
    Git.pipe(
      Effect.flatMap((git) => git.changedFiles(repo, allScope)),
      Effect.provide(GitLive),
    ),
  )

  expect(result.changed.find((entry) => entry.path === "new.txt")?.kind).toBe("untracked")
})
