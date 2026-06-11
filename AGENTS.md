# Agent Instructions

## Product

`sideye` (as in keeping a skeptical side-eye on your agent's changes) is a read-only companion TUI for CLI coding agents (claude code, opencode, codex). The user runs an agent in one terminal pane and `sideye` in another, replacing the editor they would otherwise open just to see what is there, what is happening, and what is the difference — everything an IDE shows you, nothing it does for you, with the "integrated" part deliberately missing. The human stays in charge: the tool helps inspect robot output, but it never reviews, explains, approves, rejects, gates, or talks back to an agent.

The four pillars:

1. **Full repo tree with changed overlay** — browse the entire project tree like an IDE sidebar; open and read any file (read-only, syntax highlighted); changed files are tinted and tagged in place.
2. **Simple change scopes** — all changes, staged only, and unstaged only, cycled in-app. No commit-log browser, no timelines, no snapshots.
3. **Live with activity awareness** — git polling keeps the view fresh while the agent edits; recency markers show what was just touched and decay silently; one key jumps to the latest activity.
4. **Static analysis surfaced like an IDE** — lint/tsc/fmt findings appear in a problems panel, as inline line markers in the viewer, and as per-file markers in the tree, repo-wide rather than changed-files-only; checks re-run automatically after the repo goes quiet.

The core loop is:

1. Run the agent next to `sideye` and follow its edits as they land.
2. Glance at the tree, open any file or diff, check the problems panel.
3. Copy a `path:line` reference plus snippet.
4. Paste that reference into the agent conversation and redirect in your own words.

## Technical Defaults

- Use Bun for runtime, scripts, dependency management, test commands, and build smoke checks.
- Use TypeScript with `strict` enabled.
- Use `@opentui/core` and `@opentui/react` for the terminal UI.
- Configure JSX with `jsxImportSource: "@opentui/react"`.
- Treat git output as the synchronous source of truth.
- Render the git-backed file map before any checker or diagnostic process resolves.
- Run diagnostics as independent async decorations over the stable git file list.
- Keep v1 macOS-first for clipboard support with `pbcopy`.

## Local Skills

Project skills are installed under `.agents/skills`.

- Use `.agents/skills/find-skills/SKILL.md` when discovering additional skills.
- Use `.agents/skills/bun/SKILL.md` before changing dependencies, scripts, tests, runtime behavior, or build commands.
- Use `.agents/skills/opentui/SKILL.md` before writing or changing OpenTUI code.
- For OpenTUI React work, start with `.agents/skills/opentui/docs/bindings/react.mdx`, then read component docs such as `docs/components/diff.mdx`, `docs/components/select.mdx`, `docs/components/scrollbox.mdx`, `docs/components/box.mdx`, and `docs/components/text.mdx` as needed.
- For keyboard/navigation behavior, read `.agents/skills/opentui/docs/core-concepts/keyboard.mdx` and `.agents/skills/opentui/docs/keymap/overview.mdx`.
- For testing OpenTUI behavior, read `.agents/skills/opentui/docs/core-concepts/testing.mdx`.

## Coding Conventions

- Prefer `bun run`, `bun test`, `bun install`, `bun add`, `bun add -d`, `bun remove`, and `bun build`; do not introduce Node/npm/Jest/esbuild wrappers unless explicitly requested.
- Put Bun runtime flags before `run`, such as `bun --watch run <script>`.
- Keep `bun.lock` text lockfile changes with dependency changes.
- Do not rely on transitive dependencies; declare direct dependencies in `package.json`.
- Use `===` and `!==`; never use `== null` or `!= null`.
- Avoid explicit return type annotations on functions unless needed for exported API clarity, recursion, overloads, or type inference limits.
- Prefer small typed modules for git parsing, diagnostics, clipboard, CLI args, and UI state.
- Prefer structured parsing over ad hoc string manipulation when a command offers machine-readable output.
- Keep comments sparse and useful; do not narrate obvious code.
- Do not add AI-generated sign-offs to commits, PR text, docs, or generated content.

## Implementation Guardrails

- `sideye [ref]` defaults to the `all` scope (worktree vs `HEAD`); `--staged` and `--unstaged` set the initial scope; `s` cycles scopes in-app (`unstaged` is plain `git diff` and ignores the ref).
- The tool must work in any git repo, not only this repo or agent-created worktrees.
- The tree shows the full repo from `git ls-files` (tracked) plus `git ls-files --others --exclude-standard` (untracked, so gitignore is respected), union'd with the changed set so staged deletions stay visible.
- Tree ordering is directories-first, alphabetical, always — stable under polling by construction, so the list never reorders under the cursor. Single-child directory chains flatten into one row. `c` toggles a changes-only filter.
- Include untracked files in the changed set (except in the `staged` scope) and render them as all-added diffs.
- Tag each changed file with its stage state (staged, unstaged, mixed, untracked) from `git status` and keep it distinguishable in the tree.
- The view is live: poll git and refresh the tree, diff, and file content while the user watches. Preserve selection (by path) and the cursor across refreshes; reset the cursor only on file switch.
- Selecting an unchanged file shows its full content read-only; `v` toggles a changed file between diff and full content. Full files render through the diff viewer as synthesized all-context patches. Binary, missing, and oversized files render explicit placeholders, never raw bytes.
- Recency markers come from an append-only in-memory activity event log (the seam for a future persistence layer); they decay silently (fresh under 5s, recent under 30s) and `.` jumps to the latest activity. A scope switch is not activity.
- Diagnostics retain findings for every reported path, not just changed files (tsc runs project-wide). They surface in the problems panel (`p`), as inline line markers in the viewer, and as per-file markers in the tree.
- Late diagnostics must fill badges and markers in place and never reorder the tree.
- Checker badges must use explicit states: `pending`, `clean`, `findings`, and `failed` when needed. Missing or empty diagnostics must never render as clean; a file that changes returns its badges to `pending` until checks re-run.
- Diagnostics run at startup, on `r`, and automatically once the repo has been quiet for ~2s after activity. New-vs-baseline diagnostics are deferred.
- Git data renders first; diagnostics stream in later as decorations over the stable tree.
- Do not implement an LSP client, web preview, PR workflow, accept/reject protocol, agent integration, or a database in v1.

## Verification

- Use Bun commands for local checks.
- Use `bun run check` as the default pre-submit command.
- Use `bun run build` as the Bun compile smoke check.
- Use `bun run src/main.tsx --help` as the CLI smoke check.
- Run `bun install` after package or lockfile changes.
- Add focused tests for git parsing, CLI argument handling, diagnostic parsing, checker state transitions, and copy-reference formatting.
- Keep OpenTUI rendering tests separate from pure parsing/state tests where practical.
