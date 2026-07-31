# Agent instructions

`docs/` is the stet documentation site: Fumadocs v16 on Next.js (App Router, Turbopack), a standalone Bun workspace (`@stet/docs`) deployed to Vercel with the root directory set to `docs`. Release-please does not track this workspace, so docs-only changes never cut a CLI release.

The site deploys from `main` on every push while the CLI release is gated to `packages/tui`, so the docs track `main` and can run ahead of the published version. That drift is stated, not hidden: the version-facing truth lives in release-derived surfaces (the nav version badge from `lib/version.ts`, and the Releases-API changelog), and a development-version banner on the docs pages (`components/dev-banner.tsx`, mounted in `app/docs/layout.tsx`) says so and links to the changelog. The deploy is deliberately not gated to releases, since those release-derived surfaces already carry the released version.

## Stack

- Bun for scripts and dependencies; pin every dependency to an exact version (no `^`/`~`), matching the rest of the repo.
- Fumadocs (`fumadocs-core`, `fumadocs-ui`, `fumadocs-mdx`) with `createMDX()` wired in `next.config.mjs`. Code blocks use stet's own Shiki themes from `lib/code-theme.ts`, set in `source.config.ts`.
- Tailwind v4 via `@tailwindcss/postcss`. Use Fumadocs theme tokens (`fd-*` classes: `text-fd-muted-foreground`, `border-fd-border`, `bg-fd-background`, and so on), never hardcoded colors.
- Lint and format are oxlint and oxfmt, same as the TUI, run from the repo root rather than from within `docs/`. No ESLint or Prettier.
- Async IO (server-side data fetching in `lib/`) uses Effect, the same as the TUI, but leanly: no services, layers, or `ManagedRuntime`. Write the flow as an `Effect.gen` with typed `Data.TaggedError` failures, then run it at the call boundary with `Effect.runPromise`, collapsing failure to a safe fallback via `Effect.orElseSucceed` (`lib/releases.ts` returns `[]`, `lib/version.ts` returns `undefined`). Bound any request fan-out with `Effect.forEach(..., { concurrency })`. `Data.TaggedError` is in the docs `new-cap` `capIsNewExceptions`.

## Content

- MDX content lives under `content/docs/`, wired through `lib/source.ts` (`loader` over `docs.toFumadocsSource()`). Navigation order comes from `meta.json` files; every page needs `title` and `description` frontmatter.
- Add a page by creating `content/docs/<path>.mdx` and listing its slug in the relevant `meta.json`. The URL is `/docs/<path>` (the loader `baseUrl` is `/docs`).
- `reference/keybindings.mdx` has a `GENERATED-KEYS` region populated by `bun run gen:keys` from the TUI's `src/help/keys.ts`. Never hand-edit inside that fence; run the generator.
- Frontmatter is YAML, so a `description` containing a colon followed by a space fails the parse (`Nested mappings are not allowed in compact mappings`). Rewrite the sentence rather than quoting it, which is what every existing description does.

### Screenshots

**An image earns its place by telling something the prose cannot, not by filling a section that lacks one.** That is the whole bar, and it is the one that gets skipped: a page with no image is not a gap, and an overlay that already appears on the page in another shot does not need a second near-identical one. A capture of a transient toast is rarely worth it either, because the sentence beside it already says what it says. What does earn a place: a cue with no words to describe it (the recency ramp), an arrangement a reader cannot picture (a re-docked pane), a surface whose contents the prose does not enumerate (what is actually on the context menu), and the surprising payoff of a feature (`ctrl-s` writing the config for you).

Check the capture against the sentence next to it, not just against the app. A shot of the context menu on a symbol shows a full menu, so it cannot illustrate the menu omitting rows; the prose beside it has to make that claim on its own.

The mechanics:

- Screenshots are generated, never hand-captured: `bun run screenshots` from the repo root drives the real binary through VHS (`packages/tui/script/screenshots.ts`). Pass names to shoot a subset, e.g. `bun run screenshots find problems`. Adding one means adding an entry to that file's `screens` array; do not drop a PNG into `public/screenshots/` by hand.
- Capture against a clean checkout, or point `STET_SCREENSHOT_REPO` at one, since uncommitted files show up in the captured tree and changed count.
- They live in `public/screenshots/` as lowercase kebab-case PNGs named for their screen, and embed as plain markdown images. A custom component would bypass `markdownImage` in `lib/llm-image.ts` and drop the image from `/llms.txt` and the `.md` routes.
- Alt text is sentence case, describes the state captured, and never starts with "Screenshot of". Do not quote a number the capture produces (a fold marker's line count), which the next regeneration invalidates.
- **VHS has no F-key.** It rejects a bare `F10`, and `Shift+F10` parses as shift over the literal text "F10", which it types. It cannot send a right-click either. A shot needing one of those plants a `keybindings` rebind in the throwaway config dir (`config: true` screens); this stays honest because no overlay footer names its own opener.
- A screen that depends on timing states the coupling in its JSDoc. Two are load-bearing today: an action notification clears after 1500ms, so its shot must capture inside that window, and recency needs a real edit made **while stet is watching**, since the activity log diffs successive git models and the first one is only a baseline.

### Editorial standards

- Treat the repo-root `README.md` as stet's user-facing contract, `packages/tui/SPEC.md` and `packages/tui/AGENTS.md` as its invariants, and the implementation or observed CLI output as the source for exact details. Do not treat existing docs copy as proof that a behavioral claim is current.
- Use `TUI` without expanding it. The docs are for readers who already know the acronym.
- Begin a getting-started flow with a concise introduction that defines the product and maps its main capabilities. Follow it with installation, a verification step, and the first run. Keep reference pages organized around lookup rather than forcing this order everywhere.
- After a command whose success the reader must confirm, show the verification command or expected result. Use stable placeholders such as `X.Y.Z` instead of committing a release number that will age.
- Keep control-heavy instructions scannable. Use short paragraphs for state and cause, and a compact control/action table when a paragraph would enumerate several keys or fields.
- Make headings match the section's job. Use "Introduction" for product orientation, action-oriented headings for workflows, and "inspect" only for content that describes inspection.
- Prefer direct, active, specific prose. Remove promotional adjectives, metaphors that replace behavior, formulaic negative lists, and claims such as "works out of the box" or "sensible defaults" that do not name what happens.
- Prefer a self-explaining interface over a doc. Before a page explains what the UI shows, ask whether the UI should say it itself: a legend, a label, an actionable empty or error state. A page earns its place for what the UI cannot say, the concepts, the workflow, and the why; it does not exist to translate glyphs the UI could label. The `?` marks legend is the pattern, it closed the interface guide the Coverage list once planned to write.

### Keeping docs in sync with code

The site is hand-written, so it drifts from the TUI unless it is kept honest. Prefer an enforced guard over a rule wherever a fact is enumerable from code: an enforced fact cannot drift, a rule relies on the next contributor remembering it. Two facts are enforced today, and both held where a hand-maintained copy did not. `bun run gen:keys` regenerates the keybindings region from the TUI's `src/help/keys.ts`, and `docs:check` runs `gen:keys --check`, which fails when the region no longer matches. The `?` marks legend reads each glyph from the function that draws it, and enum-keyed `Record`s in `packages/tui/src/help/legend.ts` make a new change kind, stage, or provenance tier a compile error until it earns a row.

Where generating the fact is too heavy for a guard, such as the language matrix's prose cells, it stays hand-written under two rules:

- **One owner per fact.** A fact that can be enumerated from code lives on one page; every other page links to that owner instead of restating it. Re-enumerating is how copies drift, and it already happened: the language matrix carried Rust and Go but never Python until an audit caught it.
- **Update the owner when its code changes.** A change to a `Driven by` module below must update the page that owns the fact. Nothing enforces this, so it is a review-time responsibility, named in the repo-wide docs rule in `packages/tui/AGENTS.md`.

| Fact                                                                 | Owner page                                                       | Driven by                                                                                                                      |
| -------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Language and diagnostics matrix, per-language detail                 | `docs/content/docs/reference/languages.mdx`                      | `packages/tui/src/file-support/builtins.ts`, `packages/tui/src/diagnostics/servers.ts`, `packages/tui/src/diagnostics/when.ts` |
| Config keys, environment variables, editor / theme / schema settings | `docs/content/docs/reference/configuration.mdx`                  | `packages/tui/src/config/schema.ts`, `packages/tui/src/editor/reference.ts`                                                    |
| Keybindings                                                          | `docs/content/docs/reference/keybindings.mdx` (`GENERATED-KEYS`) | `packages/tui/src/help/keys.ts`, `packages/tui/src/keys/actions.ts`, then `bun run gen:keys`                                   |
| Install, usage, flags, requirements                                  | `docs/content/docs/index.mdx`                                    | `packages/tui/src/cli.ts`                                                                                                      |
| Pane focus, resize, docking, zoom, and their minimums and defaults   | `docs/content/docs/guides/panes-and-layout.mdx`                  | `packages/tui/src/layout/regions.ts`, the pane actions in `packages/tui/src/state.ts`                                          |

### Coverage

Not every gap is a page. Per the self-explaining-interface standard above, a gap can be closed in the UI instead. What exists and is maintained, and the gaps an audit found; check a box when a gap is closed in a page or in-app, and add a row when one is filled or found.

- [x] Getting started (`index.mdx`)
- [x] Guides: panes & layout, reading files & diffs, search & navigation, code intelligence, scopes & worktrees, themes
- [x] Reference: keybindings, configuration, languages
- [x] The tree and diagnostics marks (change kinds `M`/`A`/`D`/`R`/`U`, badges, recency, the provenance rail): explained in-app by the `?` legend, not a page (#331)
- [x] The panes themselves (focus, resize, docking, zoom): `guides/panes-and-layout.mdx`
- [ ] The rest of the interface: the status bar tiers and the header (a short guide, or more in-app cues)
- [ ] Guide: working alongside an agent (the loop, live refresh and the safety poll, the non-goals contract)
- [ ] Reference: troubleshooting (`R` vs `r`, server downloads, gopls, Nerd Fonts, clipboard, config parse errors)
- [ ] Under-documented on existing pages: `session` scope's fixed base, the search pathspec grammar, large-file truncation, the changes-only filter

## Markdown for agents

- The docs are served as markdown alongside the HTML, so an agent can read them without scraping: `/llms.txt` (the index, `app/llms.txt/route.ts`), `/llms-full.txt` (every page in one file, `app/llms-full.txt/route.ts`), and one markdown route per page (`app/llms.mdx/docs/[[...slug]]/route.ts`, statically generated from `source.generateParams()`). Route handlers set `export const revalidate = false`, so all of it is built once.
- `proxy.ts` (Next's middleware entrypoint, matched to `/docs*`) routes markdown requests to that per-page route two ways: a `.md`/`.mdx` suffix on any docs URL, and a plain docs URL requested with `Accept: text/markdown` (`isMarkdownPreferred` from `fumadocs-core/negotiation`). A browser hitting the same URL still gets HTML.
- A page's markdown comes from `getLLMText` in `lib/llm.ts`, an `Effect.gen` over `page.data.getText("processed")` with an `LlmTextError` failure, run at each route boundary with `Effect.runPromise` (the `llms-full.txt` fan-out through `Effect.forEach(..., { concurrency: 5 })`, like `releases.ts`). It is the one Effect flow here with **no** `orElseSucceed` fallback: `releases.ts`/`version.ts` degrade because a flaky GitHub API must not break the build, while every failure this wraps is a defect in the content or the config (the expected one being `postprocess.includeProcessedMarkdown` off in `source.config.ts`; loading a page's compiled module can fail too), and a build that would publish empty pages should fail instead. Fumadocs' default stringifier keeps `Callout`/`Card` and flattens the rest (`Tabs`, `Cards`) to their children.
- `llms.txt` is assembled in the route (title, summary, `## Docs`, `## Optional`) from `llms(llmSource).indexNode()` per top-level tree node, not from `index()`, which would emit its own H1 mid-file. It indexes `llmSource` (`lib/source.ts`), a second loader over the same content whose `url` resolves to the absolute `.md` endpoint, so every link in the index is fetchable as-is. Page URLs everywhere else still come from `source`.
- Images are the one reference an agent dereferences outside a browser, so `markdownImage` (`lib/llm-image.ts`, the `stringify` hook) rewrites them to absolute URLs. It depends on `remarkImageOptions.useImport: false`: with the default, remarkImage turns each image into a bundler import and the markdown can only stringify its variable name (`src="__img0"`). The HTML site still renders them through next/image.

## Changelog

- `/changelog` is a standalone page in the `(home)` route group (Home layout, not the docs sidebar), linked from the footer.
- It is hydrated at build time from the GitHub Releases API, not from `packages/tui/CHANGELOG.md`. `lib/releases.ts` fetches the releases with Effect (paginated via the `Link` header, bounded concurrency, revalidated hourly, failure-tolerant to an empty list like `lib/version.ts`) and parses each release `body` with a pure parser into typed sections and notes, stripping the release-please component prefix (`stet-v`/`sideye-v`) and the trailing commit/PR link tails. The page renders that data in `app/(home)/changelog/page.tsx` as a two-column timeline (sticky version rail plus a spine), so no raw release-please markdown is rendered and there is no committed changelog copy to keep in sync.
- If the release note format changes, update the parser in `lib/releases.ts`; do not reintroduce a markdown include.

## Verification

- `bun run typecheck` (from `docs/`) runs `fumadocs-mdx && tsc --noEmit`. From the repo root, `bun run docs:check` runs `gen:keys --check` then the same, `bun run docs:build` is the `next build` smoke check, and full-repo format/lint (including `docs/`) is covered by the root `bun run check`.
- `bun install` at the repo root after any dependency or lockfile change (the workspace uses the hoisted linker).
