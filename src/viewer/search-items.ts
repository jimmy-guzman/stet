import type { SearchMatch } from "@/git/search";

/**
 * One rendered row of the search pane's results band. Headers and gaps are decorations between the
 * navigable rows; the renderer and the keymap both walk this flat list, so navigation skips the
 * non-navigable kinds. A `line` row carrying a `match` is a hit the cursor can land on; without one
 * it is surrounding context.
 */
export type SearchItem =
  | { kind: "header"; id: string; path: string; count: number; collapsed: boolean }
  | {
      kind: "line";
      id: string;
      path: string;
      line: number;
      text: string;
      lineWidth: number;
      match?: { index: number; column: number };
    }
  | { kind: "gap"; id: string; path: string };

/**
 * The rows the pane cursor can land on: match lines (enter jumps) and file headers (enter
 * collapses), but not context lines or gaps. The state memo, keymap, and pane highlight share this
 * so selection stays consistent.
 */
export function isNavigableSearchItem(item: SearchItem) {
  return item.kind === "header" || (item.kind === "line" && item.match !== undefined);
}

interface BuildSearchItemsInput {
  /** Capped matches in grep order (contiguous by path); `match.index` refers into this list. */
  matches: readonly SearchMatch[];
  /** Full line lists for matched paths; a missing path degrades to match-only rows. */
  linesByPath: ReadonlyMap<string, readonly string[]>;
  collapsed: ReadonlySet<string>;
  /** Lines of context on each side of a match. */
  context: number;
}

/**
 * Builds the grouped, ordered row list: one header per file, then that file's matches as excerpts.
 * Match blocks whose context ranges touch or overlap merge into one excerpt (Zed's model, so
 * context lines never duplicate), excerpts clamp at file edges, and a `gap` row separates
 * non-contiguous excerpts of the same file. Collapsed paths contribute only their header.
 */
export function buildSearchItems(input: BuildSearchItemsInput): SearchItem[] {
  const indexed = input.matches.map((match, index) => ({ index, match }));
  return [...Map.groupBy(indexed, (entry) => entry.match.path).entries()].flatMap(
    ([path, entries]) => {
      const header: SearchItem = {
        collapsed: input.collapsed.has(path),
        count: entries.length,
        id: `search-header-${path}`,
        kind: "header",
        path,
      };
      if (input.collapsed.has(path)) {
        return [header];
      }
      const rows = fileLineItems(path, entries, input);
      rows.unshift(header);
      return rows;
    },
  );
}

interface IndexedMatch {
  index: number;
  match: SearchMatch;
}

function fileLineItems(
  path: string,
  entries: IndexedMatch[],
  input: BuildSearchItemsInput,
): SearchItem[] {
  const lines = input.linesByPath.get(path);
  const byLine = new Map(entries.map((entry) => [entry.match.line, entry]));
  const excerpts = mergeExcerpts(
    entries.map((entry) => {
      // An unreadable file (binary, oversized), or a match past a truncated
      // Read, still shows its hit: the grep text alone, with no context.
      const within = lines !== undefined && entry.match.line <= lines.length;
      return within
        ? {
            end: Math.min(lines.length, entry.match.line + input.context),
            start: Math.max(1, entry.match.line - input.context),
          }
        : { end: entry.match.line, start: entry.match.line };
    }),
  );
  const lineWidth = Math.max(1, ...excerpts.map((excerpt) => String(excerpt.end).length));
  return excerpts.flatMap((excerpt, excerptIndex) => {
    const rows = rangeOf(excerpt).map((lineNumber): SearchItem => {
      const entry = byLine.get(lineNumber);
      const shared = {
        id: `search-line-${path}-${lineNumber}`,
        kind: "line" as const,
        line: lineNumber,
        lineWidth,
        path,
        text: lines?.[lineNumber - 1] ?? entry?.match.text ?? "",
      };
      return entry === undefined
        ? shared
        : Object.assign(shared, { match: { column: entry.match.column, index: entry.index } });
    });
    if (excerptIndex > 0) {
      rows.unshift({ id: `search-gap-${path}-${excerptIndex}`, kind: "gap", path });
    }
    return rows;
  });
}

interface Excerpt {
  start: number;
  end: number;
}

// Ranges arrive in ascending match order; touching ranges merge too, so two
// Excerpts are never adjacent without a real unshown line between them.
function mergeExcerpts(ranges: Excerpt[]): Excerpt[] {
  return ranges.reduce<Excerpt[]>((merged, range) => {
    const last = merged.at(-1);
    if (last !== undefined && range.start <= last.end + 1) {
      last.end = Math.max(last.end, range.end);
      return merged;
    }
    merged.push({ end: range.end, start: range.start });
    return merged;
  }, []);
}

function rangeOf(excerpt: Excerpt) {
  return Array.from({ length: excerpt.end - excerpt.start + 1 }, (_, i) => excerpt.start + i);
}
