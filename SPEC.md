# sideye: implementation spec

The README is the source of truth for what sideye does, its keys, and its non-goals. This file holds the invariants behind those features, the contract the README doesn't state. Read it before changing tree construction, the viewer, recency, diagnostics, scopes, or worktree handling.

## Architecture invariant

Git output is the synchronous source of truth. The git-backed file tree renders first; diagnostics arrive later as independent async decorations over the stable tree, so the basic view stays useful while checks run.

## Tree construction

- Source the tree from `git ls-files` (tracked) plus `git ls-files --others --exclude-standard` (untracked, gitignore respected), union'd with the changed set so staged deletions stay visible.
- Ordering is directories-first, then alphabetical, always: stable under polling by construction, so the list never reorders under the cursor.
- Flatten single-child directory chains into one row.
- Tag each changed file with its stage state (staged, unstaged, mixed, untracked) from `git status`.
- Include untracked files in the changed set (except in the `staged` scope) and render them as all-added diffs.
- Go-to-file (`ctrl-p`) searches the same file universe as the tree.

## Scopes

`sideye [ref]` defaults to `all` (worktree vs `HEAD`). `--staged` / `--unstaged` set the initial scope; `s` cycles. `unstaged` is plain `git diff` and ignores the ref.

## Worktrees

`w` switches the active worktree in place and re-points the tree, diffs, polling, and checks at it, with no restart. The picker lists worktrees and marks prunable ones. [confirm: source command for the list, and how a removed or pruned worktree is handled mid-session]

## Live view

Poll git and refresh the tree, diff, and file content while the user watches. Preserve selection by path and the cursor across refreshes; reset the cursor only on a file switch.

## Viewer

- Unchanged files render full content read-only. `v` toggles a changed file between diff and full content.
- Full files render through the diff viewer as synthesized all-context patches.
- Binary, missing, and oversized files render explicit placeholders, never raw bytes. `f` loads full content when truncated.

## Recency

Recency markers come from an append-only in-memory activity event log (the seam for a future persistence layer). They decay silently: fresh under 5s, recent under 30s. `.` jumps to the latest activity. A scope switch is not activity.

## Diagnostics

- Checkers are oxlint (lint), prettier (formatting), and tsc (typecheck); diagnostics parse each tool's output, and tsc runs project-wide.
- Checkers adapt to the target repo, never to sideye's own runtime. A `package.json` script runs through the detected package manager (`packageManager` field first, then lockfile, defaulting to bun); a fallback binary runs from the repo's `node_modules/.bin` (or `PATH`), never through `bunx`. Prettier runs with `--ignore-unknown` so changed files it cannot parse do not fail the checker.
- Retain findings for every reported path, not just changed files.
- Surface in the problems panel (`p`), as inline line markers in the viewer, and as per-file markers in the tree. `n` jumps to the next file with findings.
- Late diagnostics fill badges and markers in place and never reorder the tree.
- Badge states are explicit: `pending`, `clean`, `findings`, `failed`. Missing or empty diagnostics never render as clean; a file that changes returns its badges to `pending` until checks re-run.
- Checks run at startup, on `r`, and automatically once the repo has been quiet for ~2s after activity. New-vs-baseline diagnostics are deferred.
