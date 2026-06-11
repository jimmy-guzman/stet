#!/usr/bin/env bun

import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import packageJson from "../package.json"
import { App } from "./App"
import { helpText, parseArgs } from "./cli"
import { loadGitModel, resolveRepoRoot } from "./git"
import { createSyntaxConfig } from "./syntax"

try {
  const options = parseArgs(Bun.argv.slice(2))

  if (options.help) {
    console.log(helpText())
    process.exit(0)
  }

  if (options.version) {
    console.log(packageJson.version)
    process.exit(0)
  }

  const model = await loadGitModel(resolveRepoRoot(process.cwd()), options.scope)
  const syntax = await createSyntaxConfig()
  const renderer = await createCliRenderer({ exitOnCtrlC: true })
  createRoot(renderer).render(<App model={model} scope={options.scope} syntax={syntax} />)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
