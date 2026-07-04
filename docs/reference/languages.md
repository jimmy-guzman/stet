# Language support

sideye opens any file in the repo. Two kinds of language features sit on top of
that. File icons and syntax highlighting are built in and work on every file with
no setup and no server (icons need a Nerd Font in your terminal). Diagnostics and
code intelligence come from language servers, so they cover only the languages a
server handles, and sideye fetches a missing server the first time you open a
matching file.

Language support is fixed. There is no plugin or extension system, so you never
install a language and there are no per-language settings. What each language
gets is listed below.

## Support at a glance

| Language                      | Icon | Highlight | Diagnostics          | Code intel |
| ----------------------------- | :--: | :-------: | -------------------- | :--------: |
| TypeScript / JS (+ TSX / JSX) |  ✓   |     ✓     | tsc, oxlint, Biome\* |     ✓      |
| JSON / JSONC                  |  ✓   |     ✓     | schema, Biome\*      |     -      |
| YAML                          |  ✓   |     ✓     | schema               |     -      |
| CSS                           |  ✓   |     ✓     | Biome\*              |     -      |
| GraphQL                       |  -   |     ✓     | Biome\*              |     -      |
| Markdown (md / mdx)           |  ✓   |     ✓     | -                    |     -      |
| Rust, Python, Go, Ruby        |  ✓   |     ✓     | -                    |     -      |
| Shell (sh / bash / zsh)       |  ✓   |     ✓     | -                    |     -      |
| Java, Kotlin, Scala, Groovy   |  ✓   |     ✓     | -                    |     -      |
| TOML                          |  ✓   |     ✓     | -                    |     -      |

\* Biome runs only in repos that opt in with a `biome.json` or `biome.jsonc`.
Highlighting covers far more than this table lists (see
[Syntax highlighting](#syntax-highlighting)); the rows here are the families that
also get an icon or a server.

## File icons

The tree shows a Nerd Font glyph next to each file, a folder glyph for each
directory, and a distinct symlink glyph for links. Icons are monochrome for now.
They render only with a [Nerd Font](https://www.nerdfonts.com/) selected in your
terminal; without one they show as empty boxes, so pass `--no-icons` for a plain
tree.

An icon is chosen by the first rule that matches:

1. Exact filename, for files an IDE marks specially: `package.json`,
   `tsconfig.json`, `bun.lock`, `bunfig.toml`, `Dockerfile`, `Makefile`,
   `.gitignore`, `.env`, `README.md`, `pom.xml`, and the Gradle build files
   (`build.gradle`, `settings.gradle`, the `.kts` variants, `gradle.properties`,
   `gradlew`).
2. Test, spec, and story files, by their stem: `foo.test.ts`, `foo_test.go`,
   `test_foo.py`, Cypress `.cy` files, and `*.stories` / `*.story`. One test
   glyph is used across every language rather than per-framework logos.
3. License files: `LICENSE` / `LICENCE`, `COPYING`, `NOTICE`, the Creative
   Commons family, and bare SPDX ids (`MIT`, `Apache-2.0`, `GPL-3.0`, and so on).
4. Extension, the common case. Covered extensions:
   - TypeScript / JavaScript: `ts`, `mts`, `cts`, `tsx`, `js`, `mjs`, `cjs`, `jsx`
   - Data and markup: `json`, `md`, `mdx`, `css`, `csv`, `html`, `http`, `astro`,
     `toml`, `conf`, `yml`, `yaml`, `lock`, `pdf`
   - Languages: `rs`, `py`, `go`, `rb`, `sh`, `bash`, `zsh`, `java`, `jar`,
     `class`, `kt`, `kts`, `groovy`, `gvy`, `scala`, `sc`, `gradle`
   - Images: `png`, `jpg`, `jpeg`, `gif`, `webp`, `ico`, `svg`
   - Video: `mp4`, `mov`, `mkv`, `webm`, `avi`
5. Dotfile fallback: any other leading-dot file (`.editorconfig`, `.npmrc`, ...)
   gets the config glyph.
6. Everything else gets a generic file glyph.

A symlink always shows the link glyph regardless of what it points at, and it
displays its target path as content (what git stores), not the linked file.

## Syntax highlighting

Highlighting comes from [Shiki](https://shiki.style/) (its WASM oniguruma engine)
and covers any language Shiki bundles, not just the ones in the table above. A
common set is compiled at startup so those files highlight without a first-time
delay: `typescript`, `tsx`, `javascript`, `jsx`, `json`, `jsonc`, `yaml`,
`markdown`, `bash`, and `zig`. Any other bundled language is attached the first
time you open such a file. A file whose language Shiki does not recognize falls
back to plain, uncolored text.

Two filenames are highlighted as a language their extension would otherwise miss:
`*.gradle` as Groovy, and `*.rb.tmpl` (a Homebrew formula template) as Ruby.

Colors come from the active theme's `syntax` tokens, so highlighting matches the
rest of the UI. A theme can instead adopt a bundled Shiki theme by name (see
[Configuration](#configuration)). The same highlighting applies wherever code
shows: the diff, the read-only file view, search results, the hover card, and
references previews.

## Language servers

Diagnostics (the problems panel, `p`) and code intelligence come from language
servers. They are read-only: sideye reads what a server publishes and never asks
it to edit, format, or rename.

When a server is not installed, sideye fetches it on first use, in this order:

1. the repo's own `node_modules/.bin`,
2. your `PATH`,
3. a one-time download into `~/.cache/sideye/lsp/<language>`.

Preferring the repo's own binary means diagnostics match the tool version the
project pins. Pass `--no-lsp-download` (or set `SIDEYE_NO_LSP_DOWNLOAD`) to skip
step 3; with downloads off and no server found, that language reports no
diagnostics.

Everything not covered below still gets icons and highlighting, just no
diagnostics or code intelligence.

### TypeScript and JavaScript

Covers `ts`, `tsx`, `js`, `jsx`, `mjs`, `cjs`, `mts`, `cts`.

Two servers report diagnostics here, both always on, and their findings merge:
`typescript-language-server` for type errors and `oxlint` for lint (oxlint reads
the repo's `.oxlintrc.json` when present, otherwise its defaults). In a repo with
a Biome config, Biome lints these files too.

This family is also the only one with code intelligence today, since
`typescript-language-server` is the one server that provides it: go to definition
(`F12`), find references (`Shift+F12`), hover (`K`), and find symbols (`S`). See
[code intelligence](../features/code-intelligence.md) for how each behaves.

### JSON and JSONC

`vscode-json-language-server` validates JSON in every repo, against known schemas
(`package.json`, `tsconfig.json`, and others from JSON Schema Store) and against
any schema a file names inline with `$schema`. In a repo with a Biome config,
Biome lints JSON on top, and the findings merge.

sideye passes the server no schema configuration of its own. The server picks
schemas from its catalog and from a file's `$schema`, so you point a file at a
custom schema inline, not through a sideye setting.

### YAML

`yaml-language-server` validates YAML in every repo. It resolves schemas from
JSON Schema Store and honors an in-file modeline
(`# yaml-language-server: $schema=...`). As with JSON, sideye passes it no schema
setting, so a custom schema is selected with the modeline.

### CSS and GraphQL

Biome is the only server for these, so diagnostics appear only in a repo with a
`biome.json` or `biome.jsonc`. Without one, CSS still gets its icon and both
still get highlighting, but no diagnostics.

## Configuration

What you can change:

- `--no-icons`: turn off file-type icons (for a terminal without a Nerd Font).
- `--no-lsp-download` / `SIDEYE_NO_LSP_DOWNLOAD`: do not auto-download language
  servers.
- Syntax colors, through a theme's `"syntax"` field in
  `~/.config/sideye/config.jsonc`: either a bundled Shiki theme name (for example
  `"catppuccin-mocha"`) or an object overriding individual tokens like `keyword`
  or `string`. See [configuration](configuration.md) for the full config format.

What is fixed: the icon glyphs, the set of language servers, and each server's
behavior. sideye has no plugin or extension system and no per-language settings,
so language coverage is what ships in the binary. A language gains diagnostics
when a new server is wired into sideye itself, not through a setting or an
install.
