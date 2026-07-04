# Configuration

Optional, at `~/.config/sideye/config.jsonc` (`$XDG_CONFIG_HOME` is honored;
`config.json` also works). Without it, sideye follows your terminal's light/dark.
A malformed or invalid config never blocks startup: it falls back to defaults and
shows a notice.

Define themes under `themes` and pick one with `theme`: a single name, or a
`{ "dark": ..., "light": ... }` pair that follows the terminal live (flip your
terminal's appearance and sideye re-themes). A theme is a full set of `#rrggbb` tokens, or
`{ "base": <name>, ... }` that inherits another theme and overrides only the
tokens you name. Its `"syntax"` is a bundled Shiki theme name, or an object
overriding individual tokens (`keyword`, `string`, ...). See
[languages](languages.md) for how syntax colors resolve.

Use `editor` and `ide` to set persistent command templates for `e` and `o`. Both
use `{file}` and `{line}` as placeholders; `{line}` is omitted automatically
when no cursor line is available. Without a config value, each key falls back to
`SIDEYE_EDITOR` / `SIDEYE_IDE`, then `$EDITOR` / `$VISUAL`, then `vim` (editor
only); `o` does nothing if nothing is configured. A bare editor name (no
`{file}`) is expanded to a known template (`nvim` becomes `nvim +{line} {file}`,
`code` becomes `code --goto {file}:{line}`, and so on). Templates are split on
whitespace, so file paths with spaces in the editor binary path are not
supported.

```jsonc
{
  "editor": "nvim +{line} {file}",
  "ide": "code --goto {file}:{line}",
}
```

```jsonc
{
  // follow the terminal, with a custom theme on each side
  "theme": { "dark": "my-dark", "light": "my-light" },
  "themes": {
    "my-dark": { "base": "dark", "accent": { "primary": "#ffa7d9" } },
    "my-light": { "base": "light", "accent": { "primary": "#b4267a" } },
    "mocha": { "base": "dark", "syntax": "catppuccin-mocha" }, // sideye chrome, Catppuccin code
    "tweaked": { "base": "dark", "syntax": { "keyword": "#ff8800" } }, // one token changed
  },
}
```

Press `t` to open the theme switcher and try any of these without editing the
config: filter by name, move (or hover) to preview the whole UI live, `enter`
(or click) to apply, `esc` to revert. The switch lasts the session; this config
is still where a theme is made permanent.
