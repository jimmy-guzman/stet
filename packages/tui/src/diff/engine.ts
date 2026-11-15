import {
  DiffHunksRenderer,
  getSharedHighlighter,
  hydratePartialDiff,
  parsePatchFiles,
  registerCustomTheme,
  setLanguageOverride,
} from "@pierre/diffs";
import type { HunkExpansionRegion } from "@pierre/diffs";
import { Context, Effect, Layer } from "effect";

import { fileSupportForPath } from "@/file-support/registry";
import type { DiffSides } from "@/git/file-patch";
import { activeThemeName, appearance } from "@/theme/active";
import { syntaxThemeForName, themeForName } from "@/theme/registry";
import { STET_SYNTAX_THEME_NAME, syntaxTheme } from "@/theme/syntax";

import type { RenderSpan } from "./hast";
import { capCutoff, navigableLinesFromRows, rowsFromHunks } from "./rows";
import type { DiffRow, NavigableLine } from "./rows";

interface DiffLayout {
  rows: DiffRow[];
  navigable: NavigableLine[];
  /** Line rows dropped by the `maxLines` cap (0 when the whole diff fit). */
  hiddenLines: number;
}

/** A rendered diff: its layout with every gap collapsed, plus every other gap expansion. */
export interface DiffRender extends DiffLayout {
  /**
   * The layout with the given gaps (`gap:<hunk index>` marker keys) revealed. Synchronous: it
   * re-lays out the renderer's cached highlight, so a gap toggle lands in the same batch as the
   * caret remap that follows it.
   */
  expand: (gaps: ReadonlySet<string>) => DiffLayout;
}

export interface RenderInput {
  patch: string;
  full: boolean;
  maxLines: number;
  /**
   * Both sides' full text, when they are faithful to `patch`. They make the diff's gaps
   * expandable; without them (a git fallback patch) gaps render as plain separators.
   */
  sides?: DiffSides;
}

// The render theme for the active stet theme: a bundled theme id when the theme
// Opted into one (`syntaxTheme`), else a per-name custom theme built from the
// Theme's own `syntax` tokens. Per-name (not one shared "stet") so switching
// Themes attaches another theme rather than mutating the attached one, which is
// What lets the highlight cache key on it and re-theme cleanly. Diff/cursor/find
// Backgrounds are still layered from stet tokens at render time.
const diffThemeName = () => {
  const name = activeThemeName();

  return syntaxThemeForName(name) ?? `${STET_SYNTAX_THEME_NAME}:${name}`;
};

/**
 * Names already handed to `registerCustomTheme`, which logs an error on a second registration (that
 * would paint over the TUI), so each token theme registers once.
 */
const registeredThemes = new Set<string>();

/**
 * The shared highlighter with the active render theme attached, plus that theme's name. The
 * `highlights` backend bundles every lexer, so there is no grammar to load or warm: the library
 * memoizes the instance and dedupes concurrent theme resolution. Called before every render so a
 * theme switch attaches on demand.
 */
const highlighter = async () => {
  const name = activeThemeName();
  const themeName = diffThemeName();

  if (
    syntaxThemeForName(name) === undefined &&
    !registeredThemes.has(themeName)
  ) {
    const theme = Promise.resolve({
      ...syntaxTheme(themeForName(name), appearance()),
      name: themeName,
    });

    registeredThemes.add(themeName);
    registerCustomTheme(themeName, async () => await theme, "zed");
  }

  const hl = await getSharedHighlighter({
    langs: [],
    preferredHighlighter: "highlights",
    themes: [themeName],
  });

  return { hl, themeName };
};

const MAX_CACHE = 40;

// A count cap alone lets 40 large full-file renders hold hundreds of MB, since each
// Render retains every line's text. Cap on approximate bytes too, with the count as a
// Backstop for many tiny renders.
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const EMPTY_LAYOUT: DiffLayout = { hiddenLines: 0, navigable: [], rows: [] };
const EMPTY: DiffRender = { ...EMPTY_LAYOUT, expand: () => EMPTY_LAYOUT };

const cache = new Map<string, { render: DiffRender; bytes: number }>();
let cacheBytes = 0;
const inflight = new Map<string, Promise<DiffRender>>();

// Approximate retained size: the per-line text dominates (UTF-16, 2 bytes/code unit);
// `fg` labels and object overhead are ignored and offset by a conservative cap. The
// Renderer behind `expand` also holds both sides' highlighted text, counted as `retained`.
const sizeOf = (render: DiffLayout, retained: number) => {
  let units = retained;

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

/**
 * Initialize the shared highlighter (its WebAssembly module and the active theme) so the first diff
 * does not pay for it. Called at startup (and in test setup); never rejects.
 */
export const preloadDiffHighlighter = async () => {
  try {
    await highlighter();
  } catch {
    // Best-effort warm-up.
  }
};

// Content fingerprint: a hash of the full patch and sides (not sampled slices, which
// Could collide for a same-length edit outside the sampled windows and return a stale
// Render) plus the render options that change output. The active render theme is
// Part of the key so a theme switch never serves a stale-colored render.
const fingerprint = (input: RenderInput) =>
  [
    diffThemeName(),
    input.full ? 1 : 0,
    input.maxLines,
    Bun.hash(input.patch),
    input.sides === undefined ? "" : Bun.hash(input.sides.oldText),
    input.sides === undefined ? "" : Bun.hash(input.sides.newText),
  ].join(":");

/**
 * The syntax language a file highlights as, shared by the diff and any surface that renders code
 * from that file (search results), so their colors agree.
 */
export const languageForPath = (path: string) =>
  fileSupportForPath(path).syntax;

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
    const { hl, themeName } = await highlighter();
    const { tokens } = hl.codeToTokens(code, { lang, theme: themeName });

    return tokens.map((line) =>
      line.map((token) => ({ fg: token.color, text: token.content }))
    );
  } catch {
    return code.split("\n").map((line) => [{ text: line }]);
  }
};

// Only a two-sided diff has gaps to fill; `new`/`deleted` are one whole-file hunk
// And a pure rename has no hunks at all.
const HYDRATABLE = new Set(["change", "rename-changed"]);

/**
 * Parse the patch and, given both sides, hydrate it with their full contents so its gaps can be
 * expanded. The language is forced to the basename-resolved syntax because the library re-derives
 * it from `meta.name` (the full path), the fix for extensionless names in a subdirectory.
 */
const parseDiff = (input: RenderInput) => {
  const parsed = parsePatchFiles(input.patch)[0]?.files[0];

  if (parsed === undefined) {
    return parsed;
  }

  const lang = languageForPath(parsed.name);
  const meta = lang === "text" ? parsed : setLanguageOverride(parsed, lang);

  if (input.sides === undefined || !HYDRATABLE.has(meta.type)) {
    return meta;
  }

  try {
    return hydratePartialDiff("clone", meta, {
      newFile: { contents: input.sides.newText, name: meta.name },
      oldFile: {
        contents: input.sides.oldText,
        name: meta.prevName ?? meta.name,
      },
    });
  } catch {
    // Sides that disagree with the patch's hunks: keep the patch-only diff.
    return meta;
  }
};

// Reveal a gap whole: `fromStart`/`fromEnd` are lines from the gap's top and bottom,
// And together they cover it however large it is.
const WHOLE_GAP: HunkExpansionRegion = {
  fromEnd: Number.POSITIVE_INFINITY,
  fromStart: Number.POSITIVE_INFINITY,
};

const expansionMap = (gaps: ReadonlySet<string>) =>
  new Map(
    gaps
      .values()
      .map((key) => [Number(key.slice("gap:".length)), WHOLE_GAP] as const)
      .toArray()
  );

// UTF-16 units the renderer retains per source character of its whole-file highlight
// (the text plus a HAST element per token): ~44 bytes/char measured on a two-sided
// Diff of a 4k-line TypeScript file (~12MB per render), so the byte cap, not the
// Count, is what bounds a cache of large files.
const HIGHLIGHT_UNITS_PER_CHAR = 22;

const compute = async (
  input: RenderInput
): Promise<{ render: DiffRender; retained: number }> => {
  const meta = parseDiff(input);

  if (meta === undefined) {
    return { render: EMPTY, retained: 0 };
  }

  const { themeName } = await highlighter();

  // Owned by this render's closure, never by app state: it caches the whole-file
  // Highlight once, so each `expand` only re-lays out rows.
  const renderer = new DiffHunksRenderer({
    collapsedContextThreshold: 1,
    diffStyle: "unified",
    hunkSeparators: "line-info",
    // Marks the changed words of each paired removed/added line (`data-diff-span`),
    // Joining runs across one-character neutral gaps.
    lineDiffType: "word-alt",
    maxLineDiffLength: 5000,
    theme: themeName,
    tokenizeMaxLineLength: 5000,
  });

  const renderWith = (gaps: ReadonlySet<string>) => {
    renderer.setExpandedHunksMap(expansionMap(gaps));

    return renderer.renderDiff(meta);
  };

  const collapsed = renderWith(new Set());

  if (collapsed === undefined) {
    return { render: EMPTY, retained: 0 };
  }

  const { cutoff, hiddenLines } = input.full
    ? { cutoff: undefined, hiddenLines: 0 }
    : capCutoff(collapsed, input.maxLines);

  const layout = (
    result: typeof collapsed,
    gaps: ReadonlySet<string>
  ): DiffLayout => {
    const rows = rowsFromHunks(meta, result, gaps, cutoff);

    return { hiddenLines, navigable: navigableLinesFromRows(rows), rows };
  };

  const base = layout(collapsed, new Set());

  return {
    render: {
      ...base,
      expand: (gaps) =>
        gaps.size === 0 ? base : layout(renderWith(gaps) ?? collapsed, gaps),
    },
    retained:
      (meta.additionCharacterCount + meta.deletionCharacterCount) *
      HIGHLIGHT_UNITS_PER_CHAR,
  };
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
    .then(({ render, retained }) => {
      inflight.delete(key);
      const bytes = sizeOf(render, retained);
      cache.set(key, { bytes, render });
      cacheBytes += bytes;
      evict();

      return render;
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
