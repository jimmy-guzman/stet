# Accessibility

- Keyboard-operable end to end. Focus order follows visual order.
- There is no DOM or ARIA in a terminal. The accessibility surface is `NO_COLOR`, `FORCE_COLOR`, and the absence of a Nerd Font; carry meaning in text and glyphs so it survives all three.
- Meaningful glyphs and icons carry a text fallback (sideye's icons are monochrome and `--no-icons` drops them); decorative ones add nothing a reader must announce.
- Trap focus only in overlays, and return it to where it came from on close.
- Test each surface with color and icons off (`NO_COLOR=1`, `--no-icons`) at least once. If it still reads, it is accessible.
