# Interaction and state

- Every interactive element has all states designed: default, hover, focus, active, disabled, loading, error.
- Empty states are real screens. Design them. Never leave a blank pane.
- Show structure immediately rather than a spinner. sideye paints its shell from the empty model and fills it in as git resolves; follow that pattern for any async surface.
- Focus is non-negotiable and keyboard-first. The focused pane, row, or input is always visibly marked (a caret, a selection highlight, focused input colors), never left to guess.
- Make hit targets generous. The whole row or cell is clickable, not just the glyph; pad the interactive area beyond the visible mark.
- Acknowledge every action right away, even when the result takes longer.
- Preserve selection, cursor, and scroll position. Never make someone redo work after a refresh or an error.
- Disabled is a last resort. Prefer explaining why an action is unavailable over silently graying it out.
- Do not rely on hover for anything essential. It is a mouse-only enhancement, and the keyboard must reach everything without it.
