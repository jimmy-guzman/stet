import {
  getSharedHighlighter,
  parsePatchFiles,
  registerCustomTheme,
  renderDiffWithHighlighter,
  type DiffsHighlighter,
  type RenderDiffOptions,
} from "@pierre/diffs";
import { Context, Effect, Layer } from "effect";

import { SIDEYE_SHIKI_THEME, SIDEYE_SHIKI_THEME_NAME } from "../theme/shiki";
import { flattenLineSpans, type RenderSpan } from "./hast";
import { buildDiffRows, navigableLinesFromRows, type DiffRow, type NavigableLine } from "./rows";

export interface DiffRender {
  rows: DiffRow[];
  navigable: NavigableLine[];
  truncated: boolean;
}

export interface RenderInput {
  patch: string;
  full: boolean;
  maxLines: number;
}

// Syntax foreground comes from sideye's own palette, registered as a Shiki theme
// Before the highlighter loads. Diff/cursor/find/gutter backgrounds are layered
// Over it at render time.
registerCustomTheme(SIDEYE_SHIKI_THEME_NAME, () => Promise.resolve(SIDEYE_SHIKI_THEME));
const THEME = SIDEYE_SHIKI_THEME_NAME;

// Languages preloaded into the shared highlighter; an unlisted language falls
// Back to plain text via the try/catch below, so this set just covers the
// Common cases without paying to load every Shiki grammar at startup.
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

const RENDER_OPTIONS: RenderDiffOptions = {
  lineDiffType: "none",
  maxLineDiffLength: 5000,
  theme: THEME,
  tokenizeMaxLineLength: 5000,
  useTokenTransformer: false,
};

const MAX_CACHE = 40;
const EMPTY: DiffRender = { navigable: [], rows: [], truncated: false };

const cache = new Map<string, DiffRender>();
const inflight = new Map<string, Promise<DiffRender>>();

let highlighterPromise: Promise<DiffsHighlighter> | undefined;
function highlighter() {
  // The WASM (oniguruma) engine is ~10x faster than the default JS regex engine
  // For TypeScript-family grammars (cold ~125ms vs ~1300ms, warm ~5ms vs ~30ms).
  // The highlight call is synchronous and would otherwise jank the event loop.
  highlighterPromise ??= getSharedHighlighter({
    langs: LANGS,
    preferredHighlighter: "shiki-wasm",
    themes: [THEME],
  });
  return highlighterPromise;
}

// A tiny TS patch used to trigger the one-time cold grammar compile at startup
// Rather than on the first real diff (the compile is synchronous and ~125ms).
const WARM_PATCH =
  "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -0,0 +1 @@\n+const warm = 1\n";

/**
 * Warm the shared Shiki highlighter (and the TS grammar) so the first diff renders without paying
 * the one-time load/compile. Called at startup (and in test setup); never rejects.
 */
export async function preloadDiffHighlighter() {
  try {
    await highlighter();
    await renderDiff({ full: false, maxLines: 10, patch: WARM_PATCH });
  } catch {
    // Best-effort warm-up.
  }
}

// Content fingerprint: a hash of the full patch (not sampled slices, which could
// Collide for a same-length edit outside the sampled windows and return a stale
// Render) plus the render options that change output.
function fingerprint(input: RenderInput) {
  return `${input.full ? 1 : 0}:${input.maxLines}:${Bun.hash(input.patch)}`;
}

/**
 * Synchronous structure-only pass: parse + plain rows, no highlighting. Lets the viewer paint
 * instantly (one span per line = one renderable per line); the async highlight pass upgrades the
 * spans afterward, off the critical path.
 */
export function structureDiff(input: RenderInput): DiffRender {
  if (input.patch === "") {
    return EMPTY;
  }
  const meta = parsePatchFiles(input.patch)[0]?.files[0];
  if (meta === undefined) {
    return EMPTY;
  }
  const { rows, truncated } = buildDiffRows(meta, [], [], {
    full: input.full,
    maxLines: input.maxLines,
  });
  return { navigable: navigableLinesFromRows(rows), rows, truncated };
}

async function compute(input: RenderInput): Promise<DiffRender> {
  const meta = parsePatchFiles(input.patch)[0]?.files[0];
  if (meta === undefined) {
    return EMPTY;
  }

  let addSpans: RenderSpan[][] = [];
  let delSpans: RenderSpan[][] = [];
  try {
    const themed = renderDiffWithHighlighter(meta, await highlighter(), RENDER_OPTIONS);
    addSpans = themed.code.additionLines.map(flattenLineSpans);
    delSpans = themed.code.deletionLines.map(flattenLineSpans);
  } catch {
    // Unknown language or highlighter failure: render the rows as plain text.
  }

  const { rows, truncated } = buildDiffRows(meta, addSpans, delSpans, {
    full: input.full,
    maxLines: input.maxLines,
  });

  return { navigable: navigableLinesFromRows(rows), rows, truncated };
}

function evict() {
  while (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) {
      return;
    }
    cache.delete(oldest);
  }
}

/**
 * Parse + highlight + build the windowed-ready row model for one file's patch, cached by content
 * fingerprint with in-flight de-duplication. Never rejects; an empty patch or a failure resolves to
 * an empty render.
 */
export function renderDiff(input: RenderInput): Promise<DiffRender> {
  if (input.patch === "") {
    return Promise.resolve(EMPTY);
  }

  const key = fingerprint(input);
  const hit = cache.get(key);
  if (hit !== undefined) {
    return Promise.resolve(hit);
  }

  const existing = inflight.get(key);
  if (existing !== undefined) {
    return existing;
  }

  const promise = compute(input)
    .then((result) => {
      inflight.delete(key);
      cache.set(key, result);
      evict();
      return result;
    })
    .catch(() => {
      inflight.delete(key);
      return EMPTY;
    });

  inflight.set(key, promise);
  return promise;
}

export class DiffEngine extends Context.Service<
  DiffEngine,
  {
    readonly render: (input: RenderInput) => Effect.Effect<DiffRender>;
  }
>()("sideye/DiffEngine") {}

export const DiffEngineLive = Layer.sync(DiffEngine, () => {
  // Warm the highlighter when the runtime builds so the first diff is fast.
  void preloadDiffHighlighter();
  return { render: (input) => Effect.promise(() => renderDiff(input)) };
});
