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
