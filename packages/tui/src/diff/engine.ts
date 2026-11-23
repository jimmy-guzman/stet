import {
  columnCells,
  DiffHunksRenderer,
  getSharedHighlighter,
  parseDiffFromFile,
  parsePatchFiles,
  registerCustomTheme,
  setLanguageOverride,
} from "@pierre/diffs";
import type { HunkExpansionRegion, HunksRenderResult } from "@pierre/diffs";
import { Context, Effect, Layer } from "effect";
import { constUndefined } from "effect/Function";

import { fileSupportForPath } from "@/file-support/registry";
import type { DiffInput } from "@/git/file-patch";
import { activeZedTheme } from "@/theme/active";
import type { ZedTheme } from "@/theme/zed";

import type { RenderSpan } from "./hast";
import {
  capCutoff,
  collapsedGapAtLine,
  gapIndexOf,
  navigableLinesFromRows,
  rowsFromHunks,
} from "./rows";
import type { DiffLineSide, DiffRow, NavigableLine } from "./rows";

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
  gapAtLine: (line: number, side: DiffLineSide) => string | undefined;
}

/**
 * A diff to render. Both files' text makes the diff's gaps expandable; a patch alone (a git
 * fallback) renders its gaps as plain separators.
 */
export type RenderInput = DiffInput & { full: boolean; maxLines: number };

/**
 * The highlighter's name for each theme object it has been handed. `registerCustomTheme` logs an
 * error on a second registration of a name (which would paint over the TUI), so each object
 * registers once, under a fresh name: a theme replaced behind the same stet name (a re-probed
 * `system`, a reloaded user theme) gets its own entry, and the highlight cache, keyed by this name,
 * never serves the old colors.
 */
const registeredThemes = new WeakMap<ZedTheme, string>();
let themeCount = 0;

const highlighterThemeName = (theme: ZedTheme) => {
  const registered = registeredThemes.get(theme);

  if (registered !== undefined) {
    return registered;
  }

  themeCount += 1;
  const name = `stet:${themeCount}:${theme.name}`;
  registeredThemes.set(theme, name);
  registerCustomTheme(name, async () => await Promise.resolve(theme), "zed");

  return name;
};

/**
 * The shared highlighter with the active theme attached, plus that theme's name. The `highlights`
 * backend bundles every lexer, so there is no grammar to load or warm: the library memoizes the
 * instance and dedupes concurrent theme resolution. Called before every render so a theme switch
 * attaches on demand.
 */
const highlighter = async () => {
  const themeName = highlighterThemeName(activeZedTheme());

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

const EMPTY: DiffRender = {
  ...EMPTY_LAYOUT,
  expand: () => EMPTY_LAYOUT,
  gapAtLine: constUndefined,
};

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

// Content fingerprint: a hash of the full patch or files (not sampled slices, which
// Could collide for a same-length edit outside the sampled windows and return a stale
// Render) plus the render options that change output. The active render theme is
// Part of the key so a theme switch never serves a stale-colored render.
const fingerprint = (input: RenderInput) =>
  [
    highlighterThemeName(activeZedTheme()),
    input.full ? 1 : 0,
    input.maxLines,
    ...("patch" in input
      ? [Bun.hash(input.patch)]
      : [input.files.oldFile, input.files.newFile].map((file) =>
          file === null ? "-" : `${file.name}:${Bun.hash(file.contents)}`
        )),
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

// @pierre/patches for both the file diff and the changed-word marks (jsdiff output,
// 4-40x faster), with git's three lines of context so gaps match what `git diff` elides.
const DIFF_OPTIONS = {
  context: 3,
  preferredDiffLib: "@pierre/patches",
} as const;

/**
 * Parse git's patch, or diff both files. The language is forced to the basename-resolved syntax
 * because the library re-derives it from `meta.name` (the full path), the fix for extensionless
 * names in a subdirectory. `text` is forced too: left unset, the library would infer a language
 * from the extension and highlight a file whose association turned syntax off.
 */
const parseDiff = (input: RenderInput) => {
  const meta =
    "patch" in input
      ? parsePatchFiles(input.patch)[0]?.files[0]
      : parseDiffFromFile(
          input.files.oldFile,
          input.files.newFile,
          DIFF_OPTIONS,
          // Without it a wasm failure logs over the TUI and reruns on jsdiff with no
          // Deadline, outside the budget `buildDiffInput` checked.
          true
        );

  return meta === undefined
    ? undefined
    : setLanguageOverride(meta, languageForPath(meta.name));
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
      .map((key) => [gapIndexOf(key), WHOLE_GAP] as const)
      .toArray()
  );

// UTF-16 units the renderer retains per source character of its whole-file highlight
// (the text plus a HAST element per token): ~44 bytes/char measured on a two-sided
// Diff of a 4k-line TypeScript file (~12MB per render), so the byte cap, not the
// Count, is what bounds a cache of large files.
const HIGHLIGHT_UNITS_PER_CHAR = 22;

/** The unified column's row cells, the shape `rowsFromHunks` reads (empty when no rows rendered). */
const unifiedCells = (result: HunksRenderResult) =>
  result.columns.unified === undefined
    ? []
    : columnCells(result.columns.unified).content;

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
    parseDiffOptions: DIFF_OPTIONS,
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
    : capCutoff(unifiedCells(collapsed), input.maxLines);

  const layout = (result: typeof collapsed, gaps: ReadonlySet<string>) => {
    const rows = rowsFromHunks(
      meta,
      unifiedCells(result),
      result.hunkData,
      gaps,
      cutoff
    );

    return { hiddenLines, navigable: navigableLinesFromRows(rows), rows };
  };

  const base = layout(collapsed, new Set());

  return {
    render: {
      ...base,
      expand: (gaps) =>
        gaps.size === 0 ? base : layout(renderWith(gaps) ?? collapsed, gaps),
      gapAtLine: (line, side) =>
        collapsedGapAtLine(meta, base.rows, line, side),
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
  if ("patch" in input && input.patch === "") {
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
