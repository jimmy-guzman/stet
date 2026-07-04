# TASTE.md

The user docs under `docs/` describe what sideye does, AGENTS.md holds the code
and UI conventions, and `docs/architecture/` the behavioral invariants. This file
holds the craft bar every interface surface clears: how it should feel, not what
it does. Read it before adding or reworking any UI surface.

The rules are stack-agnostic. Where one is specific to a graphical or web
platform, it is restated for sideye's medium: a terminal of fixed monospace
cells, theme tokens, no shadows or blur, keyboard-first with the mouse as
enhancement. Optimize for one outcome: the result should feel inevitable, as if
it was always meant to look this way.

The rules live as pages under `docs/design/`:

1. [Operating principles](docs/design/operating-principles.md)
2. [Typography](docs/design/typography.md)
3. [Color](docs/design/color.md)
4. [Space and layout](docs/design/space-and-layout.md)
5. [Motion](docs/design/motion.md)
6. [Interaction and state](docs/design/interaction-and-state.md)
7. [Performance](docs/design/performance.md)
8. [Copy](docs/design/copy.md)
9. [Detail and polish](docs/design/detail-and-polish.md)
10. [Accessibility](docs/design/accessibility.md)
11. [What not to do](docs/design/what-not-to-do.md)
