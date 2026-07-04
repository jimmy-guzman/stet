# Usage

```sh
sideye            # whole repo, uncommitted vs HEAD
sideye main       # compare against another ref
sideye --staged   # start in the staged scope
sideye --unstaged # start in the unstaged scope
sideye --no-icons # plain tree without Nerd Font file-type icons
sideye --wrap     # wrap long lines in the viewer instead of scrolling them horizontally
sideye --editor "nvim +{line} {file}"   # terminal editor for the e key
sideye --ide    "code --goto {file}:{line}" # GUI/IDE for the o key
```

The tree shows a file-type icon next to each file and a folder glyph for each
directory; symlinks get a distinct symlink icon and show their target path as
content (the same thing git stores), not the file they point at. These are
[Nerd Font](https://www.nerdfonts.com/) glyphs and only render with a Nerd Font
selected in your terminal; without one they appear as empty boxes, so pass
`--no-icons` to fall back to a plain tree. See [languages](../reference/languages.md)
for the full icon coverage.

The [keybindings](../reference/keybindings.md) and [mouse](../reference/mouse.md)
references cover how to drive it, and [configuration](../reference/configuration.md)
covers the `editor`, `ide`, and theme settings.
