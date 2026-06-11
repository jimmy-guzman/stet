# sideye

`sideye` is a read-only terminal UI for watching a repo while a CLI coding agent
changes it.

The usual workflow is awkward. The agent is in one terminal pane, but you still
open an editor just to answer basic questions:

- What files are in this repo?
- What changed?
- What did the agent touch most recently?
- Did lint, typecheck, or formatting break?

`sideye` is meant to sit in the next pane and answer those questions without
becoming part of the agent loop. It does not review code, approve changes, talk
to the agent, or manage a workflow. It shows you the repo, the diff, and the
problems. You decide what to say next.

## What it does

- Shows the full repo tree, including tracked files and untracked files that are
  not ignored by git.
- Marks changed files in place, with staged, unstaged, mixed, and untracked
  states.
- Opens unchanged files read-only, with syntax highlighting.
- Opens changed files as diffs, with a toggle for the full file.
- Switches between all changes, staged changes, and unstaged changes.
- Polls git while the agent works, then keeps the current file and selection
  stable as the view refreshes.
- Marks recent activity and lets you jump to the latest touched file.
- Shows diagnostics in the tree, in the viewer, and in a problems panel.
- Copies a `path:line` reference and snippet so you can paste it back into the
  agent conversation.

The git-backed file tree renders first. Diagnostics come in later as decorations.
That keeps the basic view useful even when checks are still running.

## Install

```sh
# standalone binary (macOS / Linux, no runtime needed)
curl -fsSL https://raw.githubusercontent.com/jimmy-guzman/sideye/main/install.sh | bash

# npm (works with npm, bun, pnpm, yarn; pulls a prebuilt binary)
npm i -g sideye

# homebrew
brew install jimmy-guzman/tap/sideye
```

## Usage

```sh
sideye            # whole repo, worktree vs HEAD
sideye main       # compare against another ref
sideye --staged   # start in the staged scope
sideye --unstaged # start in the unstaged scope
```

## Keys

| Key         | Action                                            |
| ----------- | ------------------------------------------------- |
| `j` / `k`   | move in the tree, viewer, or problems panel       |
| `h` / `l`   | collapse / expand folders                         |
| `tab`       | switch focus between tree and viewer              |
| `enter`     | open the focused item / jump to a problem         |
| `ctrl-p`    | go to file: fuzzy-search the whole repo           |
| `s`         | cycle scope: all changes -> staged -> unstaged    |
| `c`         | toggle changes-only filter for the tree           |
| `v`         | toggle diff <-> full file view for a changed file |
| `p`         | toggle the problems panel                         |
| `.`         | jump to the most recently changed file            |
| `n`         | jump to the next file with findings               |
| `y`         | copy `path:line` + snippet at the cursor          |
| `f`         | load full content when truncated                  |
| `r`         | re-run checks                                     |
| `ctrl-d/u`  | half-page cursor movement in the viewer           |
| `g` / `G`   | jump to first / last line                         |
| `q` / `esc` | quit (esc closes the problems panel first)        |

## Requirements

- git
- macOS for clipboard copy (`pbcopy`) in v1

## Development

```sh
bun install
bun run src/main.tsx     # run from source
bun run check            # tests + typecheck
bun run build:dist       # build standalone binaries for all targets
```

## Non-goals

`sideye` is deliberately not an agent integration.

No approvals. No accept/reject protocol. No generated review explanation. No PR
workflow. No database. The agent never hears from `sideye`, only from you.
