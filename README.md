# torre

A control tower for CLI coding agents. Run claude code, opencode, or codex in one terminal pane
and `torre` in the next — and stop opening an editor just to see **what is there, what is
happening, and what is the difference**.

Everything an IDE shows you, nothing it does for you. The "integrated" part is deliberately
missing: your agent, your editor, and `torre` stay decoupled. It never reviews, explains,
approves, or talks back to an agent — you render judgment on the robot's output, then paste a
`path:line` reference back into the agent conversation to redirect it in your own words.

## Pillars

- **The whole repo, with changes overlaid.** The full project tree renders like an IDE sidebar
  (gitignore respected), changed files tinted and tagged, unchanged files quietly browsable.
  Open any file read-only with syntax highlighting; open a changed file as a diff.
- **Simple change scopes.** Cycle between all changes, staged only, and unstaged only with one
  key — no restart, no flags to remember.
- **Live, with activity awareness.** The view polls git while the agent works. Recently touched
  files get a recency dot that decays, the status bar shows the last activity, and one key jumps
  to whatever the agent just edited.
- **Static analysis where an IDE would put it.** lint, tsc, and prettier findings show up as a
  problems panel, inline line markers in the viewer, and per-file markers in the tree — anywhere
  in the repo, not just changed files. Checks re-run automatically once the repo goes quiet.

## Install

```sh
# standalone binary (macOS / Linux, no runtime needed)
curl -fsSL https://raw.githubusercontent.com/jimmy-guzman/torre/main/install.sh | bash

# npm (works with npm, bun, pnpm, yarn — pulls a prebuilt binary)
npm i -g torre

# homebrew
brew install jimmy-guzman/tap/torre
```

## Use it

```sh
torre            # whole repo, worktree vs HEAD
torre main       # compare against another ref
torre --staged   # start in the staged scope
torre --unstaged # start in the unstaged scope
```

## Keys

| Key        | Action                                              |
| ---------- | --------------------------------------------------- |
| `j` / `k`  | move in the tree, viewer, or problems panel         |
| `h` / `l`  | collapse / expand folders                           |
| `tab`      | switch focus between tree and viewer                |
| `enter`    | open the focused item / jump to a problem           |
| `s`        | cycle scope: all changes → staged → unstaged        |
| `c`        | toggle changes-only filter for the tree             |
| `v`        | toggle diff ↔ full file view for a changed file     |
| `p`        | toggle the problems panel                           |
| `.`        | jump to the most recently changed file              |
| `n`        | jump to the next file with findings                 |
| `y`        | copy `path:line` + snippet at the cursor            |
| `f`        | load full content when truncated                    |
| `r`        | re-run checks                                       |
| `ctrl-d/u` | half-page cursor movement in the viewer             |
| `g` / `G`  | jump to first / last line                           |
| `q` / `esc`| quit (esc closes the problems panel first)          |

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

## What it will not do

No AI integration, no gating, no accept/reject protocol, no generated review explanations.
The agent never hears from `torre` — only from you.
