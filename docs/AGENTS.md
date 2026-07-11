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

## Changelog

- `/changelog` is a standalone page in the `(home)` route group (Home layout, not the docs sidebar), linked from the footer.
- It is hydrated at build time from the GitHub Releases API, not from `packages/tui/CHANGELOG.md`. `lib/releases.ts` fetches the releases with Effect (paginated via the `Link` header, bounded concurrency, revalidated hourly, failure-tolerant to an empty list like `lib/version.ts`) and parses each release `body` with a pure parser into typed sections and notes, stripping the release-please component prefix (`stet-v`/`sideye-v`) and the trailing commit/PR link tails. The page renders that data in `app/(home)/changelog/page.tsx` as a two-column timeline (sticky version rail plus a spine), so no raw release-please markdown is rendered and there is no committed changelog copy to keep in sync.
- If the release note format changes, update the parser in `lib/releases.ts`; do not reintroduce a markdown include.

## Verification

- `bun run typecheck` (from `docs/`) runs `fumadocs-mdx && tsc --noEmit`. From the repo root, `bun run docs:check` runs `gen:keys --check` then the same, `bun run docs:build` is the `next build` smoke check, and full-repo format/lint (including `docs/`) is covered by the root `bun run check`.
- `bun install` at the repo root after any dependency or lockfile change (the workspace uses the hoisted linker).
