# Agent instructions

This is a Bun-workspaces monorepo. The repo root is a private orchestrator; the packages own their own code, configs, and docs:

- `packages/tui/` is `stet`, the read-only companion TUI and the published package. **Read `packages/tui/AGENTS.md` before touching it**, plus its `SPEC.md` (behavioral invariants) and `TASTE.md` (UI craft bar). All of its conventions, state/Effect rules, and verification commands live there.
- `docs/` is the documentation site (Fumadocs on Next.js), deployed to Vercel with root directory `docs`.

Root scripts delegate: `bun run check` runs the TUI's check then knip, `bun run stet` runs the TUI from source, `docs:check`/`docs:build` cover the docs workspace. Run `bun install` at the root (the workspace uses the hoisted linker; see `bunfig.toml`).

Release-please tracks only `packages/tui`, so commits that touch nothing under it never cut a CLI release. A stranded or partial release (tagged but missing assets, npm packages, or the tap update) is republished with `gh workflow run release.yml -f tag=stet-vX.Y.Z`; the push path cannot redo it, because release-please's `GITHUB_TOKEN` is blocked from creating a release for an older commit once the workflow files have changed.

## Repo-wide rules

- **Always work in a git worktree**, one branch per change; never commit directly on the default branch. Worktrees live under `.claude/worktrees/`.
- **Commit with `bunx gitzy`** (conventional commits, `type(scope): summary` with a leading gitmoji). Keep the emoji; never add a co-author or AI sign-off trailer.
- **PR description uses two sections and nothing else:** `## What` and `## Why`. No AI-attribution line anywhere.
- **Writing:** no em dashes; no `---` section dividers where a heading already does the job; straight quotes in prose; sentence case subheadings.
- **After introducing a new pattern, feature, convention, or structural change, ask whether the relevant `AGENTS.md` and/or `README.md` should be updated, then apply the changes.**
