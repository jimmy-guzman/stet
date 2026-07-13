# Agent instructions

`docs/` is the stet documentation site: Fumadocs v16 on Next.js (App Router, Turbopack), a standalone Bun workspace (`@stet/docs`) deployed to Vercel with the root directory set to `docs`. Release-please does not track this workspace, so docs-only changes never cut a CLI release.

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

### Editorial standards

- Treat the TUI's `README.md` as the user-facing contract, `SPEC.md` and `AGENTS.md` as its invariants, and the implementation or observed CLI output as the source for exact details. Do not treat existing docs copy as proof that a behavioral claim is current.
- Use `TUI` without expanding it. The docs are for readers who already know the acronym.
- Begin a getting-started flow with a concise introduction that defines the product and maps its main capabilities. Follow it with installation, a verification step, and the first run. Keep reference pages organized around lookup rather than forcing this order everywhere.
- After a command whose success the reader must confirm, show the verification command or expected result. Use stable placeholders such as `X.Y.Z` instead of committing a release number that will age.
- Keep control-heavy instructions scannable. Use short paragraphs for state and cause, and a compact control/action table when a paragraph would enumerate several keys or fields.
- Make headings match the section's job. Use "Introduction" for product orientation, action-oriented headings for workflows, and "inspect" only for content that describes inspection.
- Prefer direct, active, specific prose. Remove promotional adjectives, metaphors that replace behavior, formulaic negative lists, and claims such as "works out of the box" or "sensible defaults" that do not name what happens.

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
