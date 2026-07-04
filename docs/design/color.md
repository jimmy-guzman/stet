# Color

- Start in grayscale. If it works with color off, color is enhancement, not a crutch.
- Few colors. One accent. Neutrals do the heavy lifting.
- Define color by role, not by hue: background, surface, border, text, muted, accent, danger. These are theme tokens in `src/theme`, never hardcoded hex at a call site.
- Build ramps in a perceptual color space so steps feel evenly spaced.
- Keep text and UI marks legible against their surface; treat a comfortable contrast as a floor, not a target.
- Borders and dividers should be barely there. Low-contrast separation reads as calm.
- Dark mode is not inverted light mode. Re-derive it. Soften white text, lower saturation.
- Never signal state by color alone. Pair it with a glyph, text, or shape, so it reads under `NO_COLOR` and for colorblind users.
