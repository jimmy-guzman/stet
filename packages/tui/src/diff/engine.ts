import {
  areLanguagesAttached,
  areThemesAttached,
  getSharedHighlighter,
  parsePatchFiles,
  registerCustomTheme,
  renderDiffWithHighlighter,
  setLanguageOverride,
} from "@pierre/diffs";
import type { DiffsHighlighter, RenderDiffOptions } from "@pierre/diffs";
import { Context, Effect, Layer } from "effect";

import { fileSupportForPath } from "@/file-support/registry";
import { activeThemeName, appearance } from "@/theme/active";
import { syntaxThemeForName, themeForName } from "@/theme/registry";
import { shikiTheme, STET_SHIKI_THEME_NAME } from "@/theme/shiki";

import { flattenLineSpans } from "./hast";
import type { RenderSpan } from "./hast";
import { buildDiffRows, navigableLinesFromRows } from "./rows";
import type { DiffRow, NavigableLine } from "./rows";

export interface DiffRender {
  rows: DiffRow[];
  navigable: NavigableLine[];
  /** Line rows dropped by the `maxLines` cap (0 when the whole diff fit). */
  hiddenLines: number;
}

export interface RenderInput {
  patch: string;
  full: boolean;
  maxLines: number;
}

// The render theme for the active stet theme: a bundled Shiki id when the theme
// Opted into one (`syntaxTheme`), else a per-name custom theme built from the
// Theme's own `syntax` tokens. Per-name (not one shared "stet") so switching
// Themes attaches another theme rather than mutating the attached one, which is
// What lets the highlight cache key on it and re-theme cleanly. Diff/cursor/find
// Backgrounds are still layered from stet tokens at render time.
const diffThemeName = () => {
  const name = activeThemeName();

  return syntaxThemeForName(name) ?? `${STET_SHIKI_THEME_NAME}:${name}`;
};

/**
 * Names already handed to `registerCustomTheme`, which logs an error on a second registration (that
 * would paint over the TUI), so each token theme registers once.
 */
const registeredThemes = new Set<string>();

/**
 * Attach the active render theme to the shared highlighter, returning its name. Stet's token themes
 * register as TextMate loaders, so `@pierre/diffs` builds its own theme shape from them exactly as
 * it does for a bundled Shiki theme, and both kinds attach through the same highlighter call. An
 * attach failure leaves the render to fall back to plain text. Called before every render so a
 * theme switch attaches on demand.
 */
const ensureDiffTheme = async () => {
  const name = activeThemeName();
  const themeName = diffThemeName();

  await highlighter();

  if (areThemesAttached(themeName)) {
    return themeName;
  }

  if (
    syntaxThemeForName(name) === undefined &&
    !registeredThemes.has(themeName)
  ) {
    const theme = Promise.resolve({
      ...shikiTheme(themeForName(name), appearance()),
      name: themeName,
    });

    registeredThemes.add(themeName);
    registerCustomTheme(themeName, async () => await theme);
  }

  try {
    await getSharedHighlighter({
      langs: [],
      preferredHighlighter: "shiki-wasm",
      themes: [themeName],
    });
  } catch {
    // Attach failed; the render falls back to plain text.
  }

  return themeName;
};

// Languages warmed into the shared highlighter at startup so the common cases
// Render without paying the one-time grammar compile. Anything outside this set
// Is still highlighted: `ensureLanguages` attaches its grammar on demand below.
const LANGS = [
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "json",
  "jsonc",
  "yaml",
  "markdown",
  "bash",
  "zig",
];

// `theme` is supplied per render (the active theme can change), so it is omitted
// Here and spread in at the call site.
const RENDER_OPTIONS: Omit<RenderDiffOptions, "theme"> = {
  lineDiffType: "none",
  maxLineDiffLength: 5000,
  tokenizeMaxLineLength: 5000,
  useTokenTransformer: false,
};

const MAX_CACHE = 40;

// A count cap alone lets 40 large full-file renders hold hundreds of MB, since each
// Render retains every line's text. Cap on approximate bytes too, with the count as a
// Backstop for many tiny renders.
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const EMPTY: DiffRender = { hiddenLines: 0, navigable: [], rows: [] };

const cache = new Map<string, { render: DiffRender; bytes: number }>();
let cacheBytes = 0;
const inflight = new Map<string, Promise<DiffRender>>();

// Approximate retained size: the per-line text dominates (UTF-16, 2 bytes/code unit);
// `fg` labels and object overhead are ignored and offset by a conservative cap.
const sizeOf = (render: DiffRender) => {
  let units = 0;

  for (const row of render.rows) {
    if (row.kind === "line") {
      for (const span of row.spans) {
        units += span.text.length;
      }
    } else if (row.kind === "separator") {
      units += row.text.length;
    }
  }

  for (const line of render.navigable) {
    units += line.content.length;
  }

  return units * 2;
};

let highlighterPromise: Promise<DiffsHighlighter> | undefined;

const highlighter = async () => {
  // The WASM (oniguruma) engine is ~10x faster than the default JS regex engine
  // For TypeScript-family grammars (cold ~125ms vs ~1300ms, warm ~5ms vs ~30ms).
  // The highlight call is synchronous and would otherwise jank the event loop.
  // Created once with no theme; ensureDiffTheme attaches each render theme.
  highlighterPromise ??= getSharedHighlighter({
    langs: LANGS,
    preferredHighlighter: "shiki-wasm",
    themes: [],
  });

  return await highlighterPromise;
};

// A tiny TS patch used to trigger the one-time cold grammar compile at startup
// Rather than on the first real diff (the compile is synchronous and ~125ms).
const WARM_PATCH =
  "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -0,0 +1 @@\n+const warm = 1\n";

/**
 * Warm the shared Shiki highlighter (and the TS grammar) so the first diff renders without paying
 * the one-time load/compile. Called at startup (and in test setup); never rejects.
 */
export const preloadDiffHighlighter = async () => {
  try {
    await ensureDiffTheme();
    await renderDiff({ full: false, maxLines: 10, patch: WARM_PATCH });
  } catch {
    // Best-effort warm-up.
  }
};

// Content fingerprint: a hash of the full patch (not sampled slices, which could
// Collide for a same-length edit outside the sampled windows and return a stale
// Render) plus the render options that change output. The active render theme is
// Part of the key so a theme switch never serves a stale-colored render.
const fingerprint = (input: RenderInput) =>
  `${diffThemeName()}:${input.full ? 1 : 0}:${input.maxLines}:${Bun.hash(input.patch)}`;

/**
 * Synchronous structure-only pass: parse + plain rows, no highlighting. Lets the viewer paint
 * instantly (one span per line = one renderable per line); the async highlight pass upgrades the
 * spans afterward, off the critical path.
 */
export const structureDiff = (input: RenderInput): DiffRender => {
  if (input.patch === "") {
    return EMPTY;
  }

  const meta = parsePatchFiles(input.patch)[0]?.files[0];

  if (meta === undefined) {
    return EMPTY;
  }

  const { hiddenLines, rows } = buildDiffRows(meta, [], [], {
    full: input.full,
    maxLines: input.maxLines,
  });

  return { hiddenLines, navigable: navigableLinesFromRows(rows), rows };
};

// Grammars not in LANGS are attached on demand: the file's language is inferred
// From its name (and its pre-rename name) and loaded into the shared highlighter
// Before the synchronous render below, so any language Shiki bundles highlights
// Without preloading every grammar. Each language's attachment is memoized by
// `attaching` so concurrent renders of the same new language await one shared
// Promise instead of racing it (a render that skipped the wait would cache
// Plain-text spans before the grammar finished attaching). A successful attach
// Drops its entry (`areLanguagesAttached` dedupes thereafter), so the map only
// Retains failed extensions, which keeps a bogus extension from re-resolving on
// Every render without growing one entry per language for the process lifetime.
const attaching = new Map<string, Promise<unknown>>();

const attach = async (lang: string) => {
  const existing = attaching.get(lang);

  if (existing !== undefined) {
    return await existing;
  }

  const promise = getSharedHighlighter({
    langs: [lang],
    preferredHighlighter: "shiki-wasm",
    themes: [diffThemeName()],
  })
    .then(() => attaching.delete(lang))
    .catch(() => {
      // Not a real Shiki grammar, or a load failure: the render falls back to plain text.
      // Keep the settled entry so the failed extension is not re-resolved every render.
    });

  attaching.set(lang, promise);

  return await promise;
};

/**
 * The Shiki language a file highlights as, shared by the diff and any surface that renders code
 * from that file (search results), so their colors agree.
 */
export const languageForPath = (path: string) =>
  fileSupportForPath(path).syntax;

const ensureLanguages = async (meta: { name: string; prevName?: string }) => {
  const names =
    meta.prevName === undefined ? [meta.name] : [meta.name, meta.prevName];

  const pending = new Set(names.map(languageForPath)).difference(
    new Set(["text"])
  );

  await Promise.all(
    pending
      .values()
      .filter((lang) => !areLanguagesAttached(lang))
      .map(attach)
      .toArray()
  );
};

/**
 * Highlight a standalone code snippet (a search excerpt) into per-line spans, reusing the diff's
 * shared highlighter and active theme so the colors match. Never rejects: an unknown language or
 * highlighter failure falls back to one plain span per line, so the snippet still shows uncolored.
 */
export const highlightSnippet = async (
  code: string,
  lang: string
): Promise<RenderSpan[][]> => {
  try {
    const themeName = await ensureDiffTheme();
    const hl = await highlighter();

    if (!areLanguagesAttached(lang)) {
      await attach(lang);
    }

    const { tokens } = hl.codeToTokens(code, { lang, theme: themeName });

    return tokens.map((line) =>
      line.map((token) => ({ fg: token.color, text: token.content }))
    );
  } catch {
    return code.split("\n").map((line) => [{ text: line }]);
  }
};

const compute = async (input: RenderInput): Promise<DiffRender> => {
  const meta = parsePatchFiles(input.patch)[0]?.files[0];

  if (meta === undefined) {
    return EMPTY;
  }

  const themeName = await ensureDiffTheme();
  const hl = await highlighter();
  await ensureLanguages(meta);

  let addSpans: RenderSpan[][] = [];
  let delSpans: RenderSpan[][] = [];

  try {
    // The library re-derives the language from `meta.name` (the full path) internally,
    // So force the basename-resolved grammar; a no-op for extension files that already
    // Match, the fix for extensionless names in a subdirectory.
    const lang = languageForPath(meta.name);
    const target = lang === "text" ? meta : setLanguageOverride(meta, lang);

    const themed = renderDiffWithHighlighter(target, hl, {
      ...RENDER_OPTIONS,
      theme: themeName,
    });

    addSpans = themed.code.additionLines.map(flattenLineSpans);
    delSpans = themed.code.deletionLines.map(flattenLineSpans);
  } catch {
    // Unknown language or highlighter failure: render the rows as plain text.
  }

  const { hiddenLines, rows } = buildDiffRows(meta, addSpans, delSpans, {
    full: input.full,
    maxLines: input.maxLines,
  });

  return { hiddenLines, navigable: navigableLinesFromRows(rows), rows };
};

const evict = () => {
  // Keep the just-inserted (possibly oversized) render even when it alone exceeds the
  // Byte cap: it is the one being viewed.
  while (
    cache.size > MAX_CACHE ||
    (cacheBytes > MAX_CACHE_BYTES && cache.size > 1)
  ) {
    const key = cache.keys().next().value;

    if (key === undefined) {
      return;
    }

    const entry = cache.get(key);
    cache.delete(key);

    if (entry !== undefined) {
      cacheBytes -= entry.bytes;
    }
  }
};

/**
 * Parse + highlight + build the windowed-ready row model for one file's patch, cached by content
 * fingerprint with in-flight de-duplication. Never rejects; an empty patch or a failure resolves to
 * an empty render.
 */
export const renderDiff = async (input: RenderInput): Promise<DiffRender> => {
  if (input.patch === "") {
    return EMPTY;
  }

  const key = fingerprint(input);
  const hit = cache.get(key);

  if (hit !== undefined) {
    return hit.render;
  }

  const existing = inflight.get(key);

  if (existing !== undefined) {
    return await existing;
  }

  const promise = compute(input)
    .then((result) => {
      inflight.delete(key);
      const bytes = sizeOf(result);
      cache.set(key, { bytes, render: result });
      cacheBytes += bytes;
      evict();

      return result;
    })
    .catch(() => {
      inflight.delete(key);

      return EMPTY;
    });

  inflight.set(key, promise);

  return await promise;
};

export class DiffEngine extends Context.Service<
  DiffEngine,
  {
    readonly render: (input: RenderInput) => Effect.Effect<DiffRender>;
  }
>()("stet/DiffEngine") {}

export const DiffEngineLive = Layer.sync(DiffEngine, () => {
  // Warm the highlighter when the runtime builds so the first diff is fast.
  void preloadDiffHighlighter();

  return {
    render: (input) => Effect.promise(async () => await renderDiff(input)),
  };
});
