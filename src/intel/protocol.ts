/**
 * LSP wire types for code-intelligence replies and the mapping onto sideye's `NormalizedLocation`.
 * Pure (no Effect/Solid), so it unit-tests like `git/tree`. The 1-based line/column mirror
 * `diagnostics/protocol.ts` so a result flows straight into a `JumpTarget`.
 */
import { fileURLToPath } from "node:url";

interface LspPosition {
  line: number;
  character: number;
}

interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

interface LspLocation {
  uri: string;
  range: LspRange;
}

interface LspLocationLink {
  targetUri: string;
  targetRange: LspRange;
  targetSelectionRange?: LspRange;
}

export interface NormalizedLocation {
  path: string;
  /** 1-based (LSP positions are 0-based). */
  line: number;
  /** 1-based start column (LSP `character` is a 0-based UTF-16 offset). */
  column: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPosition(value: unknown): value is LspPosition {
  return isObject(value) && typeof value.line === "number" && typeof value.character === "number";
}

function isRange(value: unknown): value is LspRange {
  return isObject(value) && isPosition(value.start) && isPosition(value.end);
}

function isLocation(value: unknown): value is LspLocation {
  return isObject(value) && typeof value.uri === "string" && isRange(value.range);
}

function isLocationLink(value: unknown): value is LspLocationLink {
  return (
    isObject(value) &&
    typeof value.targetUri === "string" &&
    isRange(value.targetRange) &&
    // `targetSelectionRange` is optional, but a present-but-malformed one would crash the `.start`
    // Read in `mapItem`; require it to be a valid range when supplied so the link is skipped instead.
    (value.targetSelectionRange === undefined || isRange(value.targetSelectionRange))
  );
}

function locationFrom(uri: string, start: LspPosition): NormalizedLocation | undefined {
  // A server may point at a non-file resource (e.g. `untitled:`, `jdt://`); `fileURLToPath` throws
  // On those, so skip them and let the other results through rather than aborting the whole reply.
  if (!uri.startsWith("file:")) {
    return undefined;
  }
  return { column: start.character + 1, line: start.line + 1, path: fileURLToPath(uri) };
}

function mapItem(item: unknown): NormalizedLocation | undefined {
  if (isLocation(item)) {
    return locationFrom(item.uri, item.range.start);
  }
  // A `LocationLink` points at the symbol's name range (`targetSelectionRange`) when present,
  // Falling back to the whole declaration (`targetRange`).
  if (isLocationLink(item)) {
    return locationFrom(item.targetUri, (item.targetSelectionRange ?? item.targetRange).start);
  }
  return undefined;
}

function isNormalized(value: NormalizedLocation | undefined): value is NormalizedLocation {
  return value !== undefined;
}

/** `textDocument/definition` replies with a single `Location`, a list, a `LocationLink[]`, or null. */
export function normalizeDefinition(reply: unknown): NormalizedLocation[] {
  if (Array.isArray(reply)) {
    return reply.map(mapItem).filter(isNormalized);
  }
  const single = mapItem(reply);
  return single === undefined ? [] : [single];
}

/** `textDocument/references` replies with a `Location[]` or null (never a single or a link). */
export function normalizeReferences(reply: unknown): NormalizedLocation[] {
  return Array.isArray(reply) ? reply.map(mapItem).filter(isNormalized) : [];
}

/**
 * One piece of a hover reply: a fenced code block (carrying its language, for syntax highlighting)
 * or a run of prose. The fence delimiters themselves are dropped; the card highlights code segments
 * and renders prose plain.
 */
export type HoverSegment =
  | { kind: "code"; lang: string | undefined; lines: string[] }
  | { kind: "prose"; lines: string[] };

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]?.trim() === "") {
    start += 1;
  }
  while (end > start && lines[end - 1]?.trim() === "") {
    end -= 1;
  }
  return lines.slice(start, end);
}

// Split a markdown string into ordered code-fence and prose segments. A line whose
// First non-space is ``` toggles code mode; the opening fence's info string is the
// Code language, and the fence lines themselves are dropped.
function markdownSegments(text: string): HoverSegment[] {
  const segments: HoverSegment[] = [];
  let prose: string[] = [];
  let code: string[] | undefined;
  let lang: string | undefined;
  const flushProse = () => {
    const lines = trimBlankEdges(prose);
    if (lines.length > 0) {
      segments.push({ kind: "prose", lines });
    }
    prose = [];
  };
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      if (code === undefined) {
        flushProse();
        lang = line.trimStart().slice(3).trim() || undefined;
        code = [];
      } else {
        segments.push({ kind: "code", lang, lines: trimBlankEdges(code) });
        code = undefined;
        lang = undefined;
      }
      continue;
    }
    (code ?? prose).push(line);
  }
  // An unterminated fence (a malformed reply) still yields its code.
  if (code !== undefined) {
    segments.push({ kind: "code", lang, lines: trimBlankEdges(code) });
  }
  flushProse();
  return segments;
}

function segmentsFromItem(item: unknown): HoverSegment[] {
  if (typeof item === "string") {
    return markdownSegments(item);
  }
  if (!isObject(item)) {
    return [];
  }
  // A `MarkedString` code segment carries its own language and is not fenced.
  if (typeof item.language === "string" && typeof item.value === "string") {
    return [
      {
        kind: "code",
        lang: item.language || undefined,
        lines: trimBlankEdges(item.value.split("\n")),
      },
    ];
  }
  // A `MarkupContent`: markdown may carry fences, plaintext is prose.
  if (typeof item.value === "string") {
    return item.kind === "markdown"
      ? markdownSegments(item.value)
      : [{ kind: "prose", lines: trimBlankEdges(item.value.split("\n")) }];
  }
  return [];
}

/**
 * `textDocument/hover` replies with `{ contents, range? }` or null, where `contents` is a
 * `MarkupContent`, a `MarkedString`, or a `MarkedString[]`. Parsed into ordered code/prose
 * segments; an empty array means there is nothing to show.
 */
export function parseHover(reply: unknown): HoverSegment[] {
  if (!isObject(reply)) {
    return [];
  }
  const { contents } = reply;
  const items = Array.isArray(contents) ? contents : [contents];
  return items.flatMap(segmentsFromItem).filter((segment) => segment.lines.length > 0);
}
