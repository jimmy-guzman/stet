# Agent instructions

This is a Bun-workspaces monorepo. The repo root is a private orchestrator; the packages own their own code, configs, and docs:

- `packages/tui/` is `stet`, the read-only companion TUI and the published package. **Read `packages/tui/AGENTS.md` before touching it**, plus its `SPEC.md` (behavioral invariants) and `TASTE.md` (UI craft bar). All of its conventions, state/Effect rules, and verification commands live there.
- `docs/` is the documentation site (Fumadocs on Next.js), deployed to Vercel with root directory `docs`. It deploys from `main` on every push, so the docs track `main` and can run ahead of the gated CLI release; the nav version badge and the Releases-API changelog carry the released version, and a development-version banner on the docs pages signals the drift.

Root scripts delegate: `bun run check` runs `fmt:check`, `lint`, `test`, `typecheck`, and `knip`, in that order, across the whole repo (`fmt:check`/`lint` run oxfmt/oxlint once from the root, and each workspace's `oxlint.config.ts` extends the root one, and `typecheck` fans out to every workspace's own `typecheck` script via `bun run --filter '*' typecheck`, currently `packages/tui` and `docs`). `bun run stet` runs the TUI from source, and `docs:check`/`docs:build` cover the docs workspace on their own (`docs:check` runs `gen:keys --check` plus docs' `typecheck`). `bun run fmt`/`bun run lint:fix` are the write-mode counterparts, also run from the root, not from inside an individual workspace. Run `bun install` at the root (the workspace uses the hoisted linker; see `bunfig.toml`).

Lint and format come from [Ultracite](https://www.ultracite.ai) on oxlint and oxfmt, with its defaults: the root `oxlint.config.ts` extends `ultracite/oxlint/core`, `packages/tui/oxlint.config.ts` adds `ultracite/oxlint/solid`, `docs/oxlint.config.ts` adds `ultracite/oxlint/next` and `ultracite/oxlint/react`, and `oxfmt.config.ts` spreads `ultracite/oxfmt`. Overrides exist only where nothing else works: type-aware linting stays on, `.agents` is ignored (its skills are pinned by hash in `skills-lock.json`), and oxfmt skips `packages/tui/CHANGELOG.md` (release-please regenerates it). Fix a finding in code, never by turning a rule off. The configs are TypeScript, which oxlint/oxfmt can load only on Node 22.18 or later, so every script and hook runs them under Bun's runtime (`bun --bun x oxlint`, `bun --bun x ultracite fix`); a bare `bunx oxlint` fails on an older Node.

Release-please tracks only `packages/tui`, so commits that touch nothing under it never cut a CLI release. A stranded or partial release (tagged but missing assets, npm packages, or the tap update) is republished with `gh workflow run release.yml -f tag=stet-vX.Y.Z`; the push path cannot redo it, because release-please's `GITHUB_TOKEN` is blocked from creating a release for an older commit once the workflow files have changed.

## Repo-wide rules

- **Always work in a git worktree**, one branch per change; never commit directly on the default branch. Worktrees live under `.claude/worktrees/`.
- **Commit with `bunx gitzy`** (conventional commits, `type(scope): summary` with a leading gitmoji). Keep the emoji; never add a co-author or AI sign-off trailer.
- **PR description uses two sections and nothing else:** `## What` and `## Why`. No AI-attribution line anywhere.
- **Writing:** no em dashes; no `---` section dividers where a heading already does the job; straight quotes in prose; sentence case subheadings.
- **Technical prose:** state behavior directly and fact-check it against source or observed output. Avoid metaphors, vague claims, rhetorical setups, and negative-list buildup.
- **Technical literals:** use inline code for commands, flags, keybindings, paths, filenames, environment variables, config keys and values, executables, and package names. Do not code-style product prose or general concepts.
- **Issues:** the title is an imperative, sentence-case sentence naming the desired behavior ("Peek a definition inline"), with no `type(scope):` prefix, since the labels carry that. The body uses `## What`, `## Why`, and `## How`, plus `## When` for an unresolved prerequisite. Each issue carries one `type:*`, one `scope:*` when one fits, and one `priority:*`; the priority rubric lives in the label descriptions (`gh label list`).
- **After introducing a new pattern, feature, convention, or structural change, ask whether the relevant `AGENTS.md` and/or `README.md` should be updated, then apply the changes.**

## Ultracite commands

Run from the repo root, under Bun's runtime (see above):

- `bun --bun x ultracite fix`: format and apply safe lint fixes.
- `bun --bun x ultracite check`: report what is left.
- `bun --bun x ultracite doctor`: verify the setup.
