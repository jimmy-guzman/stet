/**
 * The `workspace/didChangeWatchedFiles` half of document sync: which on-disk paths each server
 * asked to hear about, and whether a given path is one of them.
 *
 * A server declares this itself, via `client/registerCapability`, rather than stet guessing per
 * language. That distinction is the whole point: a manifest table would have to know that pyright
 * cares about `site-packages` but oxlint cares about `.oxlintrc.json`, and it would guess wrong the
 * moment a server changes its mind. Here the server names its own globs and stet only filters.
 *
 * Pure by design (no Effect/Solid/OpenTUI): the transport owns the registration map and the
 * lifetimes, this module owns the parsing and the matching, so both unit-test like `git/tree`.
 */
import { existsSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** LSP `FileChangeType`: created, changed, deleted. */
type FileChangeType = 1 | 2 | 3;

export interface WatchedFileEvent {
  /** Absolute path. */
  readonly path: string;
  readonly type: FileChangeType;
}

interface CompiledWatcher {
  /**
   * Absolute directory the glob matches relative to: a `RelativePattern`'s base, the literal prefix
   * of an absolute glob, or the worktree root for a bare one. Always a real directory, so a base
   * outside the worktree can be watched (`outOfTreeBases`) rather than merely matched.
   */
  readonly base: string;
  readonly glob: Bun.Glob;
  /** LSP `WatchKind` bitmask: 1 create, 2 change, 4 delete. Defaults to 7 (all) per the spec. */
  readonly kind: number;
}

/** The `WatchKind` bit a change type corresponds to, so a watcher only hears what it registered for. */
const KIND_BIT: Record<FileChangeType, number> = { 1: 1, 2: 2, 3: 4 };

export interface WatcherRegistration {
  readonly id: string;
  readonly watchers: readonly CompiledWatcher[];
}

const METHOD = "workspace/didChangeWatchedFiles";

/**
 * Determines whether a value is a non-null object.
 *
 * @param value - The value to inspect
 * @returns `true` if the value is a non-null object, `false` otherwise.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Classifies a filesystem path as created, changed, or deleted.
 *
 * @param path - The filesystem path to classify
 * @param renamed - Whether the filesystem event was reported as a rename
 * @returns The path and its corresponding LSP file change type
 */
export function watchedFileEvent(path: string, renamed: boolean): WatchedFileEvent {
  if (!existsSync(path)) {
    return { path, type: 3 };
  }
  return { path, type: renamed ? 1 : 2 };
}

/**
 * Extracts a URI string from a direct string or an object with a string `uri` property.
 *
 * @param baseUri - The URI value to inspect
 * @returns The extracted URI string, or `undefined` when the value has no valid URI
 */
function baseUriString(baseUri: unknown) {
  if (typeof baseUri === "string") {
    return baseUri;
  }
  return isObject(baseUri) && typeof baseUri.uri === "string" ? baseUri.uri : undefined;
}

/**
 * Converts a file URI value into a filesystem path.
 *
 * @param baseUri - A URI string or an object containing a `uri` string
 * @returns The corresponding filesystem path, or `undefined` when the value is invalid or does not use a file URI
 */
function baseDirectory(baseUri: unknown) {
  const uri = baseUriString(baseUri);
  if (uri === undefined) {
    return undefined;
  }
  try {
    return fileURLToPath(uri);
  } catch {
    // A non-file scheme (a server watching an in-memory or remote document) has no path to watch.
    return undefined;
  }
}

/**
 * Determines the directory prefix before the first wildcard in a path pattern.
 *
 * @param pattern - The path pattern to inspect
 * @returns The literal directory prefix, or the path separator when no prefix exists
 */
function literalPrefix(pattern: string) {
  const parts = pattern.split(sep);
  const wildcard = parts.findIndex((part) => /[*?{}[\]]/.test(part));
  return (wildcard === -1 ? parts.slice(0, -1) : parts.slice(0, wildcard)).join(sep) || sep;
}

/**
 * Compiles a file-watch pattern relative to its appropriate filesystem base.
 *
 * @param pattern - A workspace-relative or absolute glob pattern, or an object containing a pattern and base URI
 * @param kind - The watch-kind bitmask associated with the pattern
 * @param repoRoot - The workspace root used for relative patterns
 * @returns The compiled watcher, or `undefined` when the pattern has an unsupported shape or invalid base URI
 */
function compileGlob(
  pattern: unknown,
  kind: number,
  repoRoot: string,
): CompiledWatcher | undefined {
  // A bare glob is workspace-relative (pyright registers `**` and `**/pyrightconfig.json`). An
  // Absolute one is re-rooted at its literal prefix so it is watchable when it points out of tree.
  if (typeof pattern === "string") {
    if (!isAbsolute(pattern)) {
      return { base: repoRoot, glob: new Bun.Glob(pattern), kind };
    }
    const base = literalPrefix(pattern);
    return { base, glob: new Bun.Glob(relative(base, pattern)), kind };
  }
  if (isObject(pattern) && typeof pattern.pattern === "string") {
    const base = baseDirectory(pattern.baseUri);
    return base === undefined ? undefined : { base, glob: new Bun.Glob(pattern.pattern), kind };
  }
  return undefined;
}

/**
 * Compiles valid file-watcher registrations from client registration options.
 *
 * @param registerOptions - Registration options containing watcher definitions
 * @param repoRoot - Absolute workspace root used for relative patterns
 * @returns Compiled watchers, or an empty array when the options are invalid
 */
function compileWatchers(registerOptions: unknown, repoRoot: string) {
  if (!isObject(registerOptions) || !Array.isArray(registerOptions.watchers)) {
    return [];
  }
  return registerOptions.watchers
    .filter(isObject)
    .map((watcher) =>
      compileGlob(
        watcher.globPattern,
        typeof watcher.kind === "number" ? watcher.kind : 7,
        repoRoot,
      ),
    )
    .filter((watcher) => watcher !== undefined);
}

/**
 * Determines whether a value identifies a watched-file capability registration.
 *
 * @param value - The value to check
 * @returns `true` if the value has a string `id` and the watched-files method, `false` otherwise.
 */
function isWatcherRegistration(
  value: unknown,
): value is { id: string; method: string; registerOptions?: unknown } {
  return isObject(value) && typeof value.id === "string" && value.method === METHOD;
}

/**
 * Parses file-watching registrations from a client capability-registration payload.
 *
 * @param params - The capability-registration payload to parse
 * @param repoRoot - The workspace root used to resolve relative watcher patterns
 * @returns Compiled file-watching registrations with at least one valid watcher
 */
export function parseWatcherRegistrations(params: unknown, repoRoot: string) {
  if (!isObject(params) || !Array.isArray(params.registrations)) {
    return [];
  }
  return params.registrations
    .filter(isWatcherRegistration)
    .map((registration) => ({
      id: registration.id,
      watchers: compileWatchers(registration.registerOptions, repoRoot),
    }))
    .filter((registration) => registration.watchers.length > 0) satisfies WatcherRegistration[];
}

/**
 * Extracts watcher registration IDs from an unregister capability payload.
 *
 * @param params - The capability payload to parse
 * @returns The IDs of valid file-watcher registrations
 */
export function parseWatcherUnregistrations(params: unknown) {
  if (!isObject(params) || !Array.isArray(params.unregisterations)) {
    return [];
  }
  return params.unregisterations
    .filter(isWatcherRegistration)
    .map((registration) => registration.id);
}

/**
 * Determines whether a filesystem event matches a compiled watcher.
 *
 * @returns `true` if the event type is enabled and its path matches the watcher, `false` otherwise.
 */
function matchesWatcher(watcher: CompiledWatcher, event: WatchedFileEvent) {
  // A server that registered for creates only must not be handed changes and deletions: the `kind`
  // Filter is the client's job, and honoring it is what keeps a create-only search-path watcher from
  // Being dragged into a full reanalysis on every save.
  if ((watcher.kind & KIND_BIT[event.type]) === 0) {
    return false;
  }
  const within = relative(watcher.base, event.path);
  // `relative` escapes with `..` (or stays absolute across drives) exactly when the path lies
  // Outside the base, which is the set of paths this watcher did not ask for.
  if (within === "" || within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) {
    return false;
  }
  return watcher.glob.match(within);
}

/**
 * Determines whether a filesystem event matches any registered watcher.
 *
 * @returns `true` if any watcher matches the event, `false` otherwise.
 */
export function matchesWatchers(
  registrations: readonly WatcherRegistration[],
  event: WatchedFileEvent,
) {
  return registrations.some((registration) =>
    registration.watchers.some((watcher) => matchesWatcher(watcher, event)),
  );
}

/**
 * Identifies watcher bases located outside the worktree.
 *
 * @param repoRoot - The absolute path of the worktree root
 * @returns A sorted list of unique watcher bases outside the worktree
 */
export function outOfTreeBases(registrations: readonly WatcherRegistration[], repoRoot: string) {
  return [
    ...new Set(
      registrations
        .flatMap((registration) => registration.watchers)
        .map((watcher) => watcher.base)
        .filter((base) => base !== repoRoot && !base.startsWith(`${repoRoot}${sep}`)),
    ),
  ].toSorted((a, b) => a.localeCompare(b));
}
