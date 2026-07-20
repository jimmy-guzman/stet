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
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** LSP `FileChangeType`: created, changed, deleted. */
type FileChangeType = 1 | 2 | 3;

interface WatchedFileEvent {
  /** Absolute path. */
  readonly path: string;
  readonly type: FileChangeType;
}

/**
 * One path the filesystem watcher reported, before anything has decided whether a server wants it.
 * Deliberately untyped (no `FileChangeType`): typing a change costs a stat, so it must not happen
 * until a glob has claimed the path. Structurally the watcher's own `WatchedChange`, restated here
 * so the diagnostics domain owns the shape of its input rather than depending on the watcher's.
 */
export interface WatchedPathChange {
  /** Relative to the root passed alongside it. */
  readonly path: string;
  readonly renamed: boolean;
}

/** The LSP `FileEvent` shape sent on the wire. */
interface FileEvent {
  readonly type: FileChangeType;
  readonly uri: string;
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
 * The LSP change type for a path the filesystem watcher just reported. `fs.watch` reports a rename
 * when a path appears or vanishes and a change when it is rewritten in place, so presence on disk
 * separates the first pair and the flag separates them from the second.
 *
 * **Created vs Changed is load-bearing, not cosmetic.** basedpyright rescans its import search
 * paths for _new_ packages only when at least one event in a batch is a Create; a batch of pure
 * Changes downgrades it to `LibraryWatcherContentOnlyChanged`, which re-reads the library files it
 * already knew about and so never discovers the package that was just installed. Reporting an
 * install as a Change leaves `Import "x" could not be resolved` on screen forever, which is the
 * bug. The converse matters too: reporting an ordinary edit as a Create would push pyright's source
 * watcher from a cheap `markFilesDirty` into a full reanalysis on every save.
 *
 * @param path - The filesystem path to classify
 * @param renamed - Whether the filesystem event was reported as a rename
 * @returns The path and its corresponding LSP file change type
 */
function watchedFileEvent(path: string, renamed: boolean): WatchedFileEvent {
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
 * @returns The corresponding filesystem path, or `undefined` when the value is invalid or does not
 *   use a file URI
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
 * The directory an absolute glob is rooted at: its leading components up to the first wildcard.
 * This is what turns `/opt/pyenv/versions/3.14/lib/**` into a base that can actually be _watched_,
 * rather than a pattern that only ever gets matched against events some other watcher happened to
 * deliver.
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
 * @param pattern - A workspace-relative or absolute glob pattern, or an object containing a pattern
 *   and base URI
 * @param kind - The watch-kind bitmask associated with the pattern
 * @param repoRoot - The workspace root used for relative patterns
 * @returns The compiled watcher, or `undefined` when the pattern has an unsupported shape or
 *   invalid base URI
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
 * The file-watching registrations in a `client/registerCapability` payload. A server registers
 * other methods through the same request (formatting, code actions); those are dropped, since stet
 * honors only file watching. A registration whose globs all fail to compile is dropped too, so it
 * can never sit in the map matching nothing.
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
 * The registration ids a `client/unregisterCapability` payload drops.
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

function matchesPath(watcher: CompiledWatcher, path: string) {
  const within = relative(watcher.base, path);
  // `relative` escapes with `..` (or stays absolute across drives) exactly when the path lies
  // Outside the base, which is the set of paths this watcher did not ask for.
  if (within === "" || within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) {
    return false;
  }
  return watcher.glob.match(within);
}

/**
 * The `WatchKind` bits the registered watchers want for this path, OR'd together; `0` means no
 * server asked about it at all.
 *
 * **Matching the path is separate from matching the kind because the kind costs a syscall.** A
 * change's LSP type is only knowable by stat'ing it (`fs.watch` reports one `rename` for both an
 * appearance and a vanishing, so presence on disk is the only evidence), and an install fires this
 * for every file it writes: 32k `existsSync` calls on the one thread that also renders the TUI is a
 * multi-hundred-millisecond freeze. So the caller matches the path first, and only pays the stat
 * for a path some watcher actually claimed, then filters the resulting type through `acceptsKind`.
 *
 * The accepted set is unchanged by the split: `∃w. kindBit(w) ∧ pathMatch(w)` is exactly
 * `(⋁_{pathMatch(w)} kind(w)) & bit ≠ 0`. Honoring the bitmask is still the client's job, and it is
 * what keeps a create-only search-path watcher from being dragged into a full reanalysis on a
 * save.
 *
 * @param path - The absolute path that changed
 * @returns The OR of every matching watcher's `kind`, or `0` when none match
 */
export function watchedKindMask(registrations: readonly WatcherRegistration[], path: string) {
  let mask = 0;
  for (const registration of registrations) {
    for (const watcher of registration.watchers) {
      if (matchesPath(watcher, path)) {
        mask |= watcher.kind;
      }
    }
  }
  return mask;
}

/**
 * Whether a watcher that wants `mask` asked to hear about a change of this type.
 *
 * @returns `true` if the mask carries the type's `WatchKind` bit
 */
function acceptsKind(mask: number, type: FileChangeType) {
  return (mask & KIND_BIT[type]) !== 0;
}

/**
 * The LSP `FileEvent`s a batch of raw watcher changes produces for these registrations: match the
 * path, then and only then pay the stat that types it.
 *
 * **The order is the whole point.** An agent's `bun install` or `uv sync` hands this tens of
 * thousands of paths in one batch, and `watchedFileEvent` is a synchronous `existsSync` on the one
 * thread that also renders the TUI (Bun runs JS single-threaded, so 32k stats measured 207ms of
 * frozen frames and queued keystrokes). Typing every path and letting the caller discard the ones
 * no server claimed made every repo pay that freeze up front, even for the paths no registered glob
 * wanted. Several built-ins register globs (basedpyright, oxlint in every JS/TS repo, ruff, ty, and
 * gopls; rust-analyzer stays pinned to its own watcher), so the point is not that the channel goes
 * unused but that an install writes tens of thousands of paths and each server claims only a narrow
 * slice (or, like pyright's `**`, all of them, which is why the typing is chunked). Matching first
 * makes the stat unreachable for a path nobody asked about.
 *
 * `isTracked` is git's view of the path, the tiebreak `fs.watch` cannot give: a rename over a path
 * git already knows is an atomic save (write-temp then rename, which vim and most formatters do),
 * so calling it a create would drag pyright's source watcher out of a cheap dirty-mark and into a
 * full reanalysis on every save. A rename to a path git has never heard of _is_ an appearance: a
 * new source file, or the package that just landed in gitignored `.venv/`, which is the event this
 * whole channel exists for. A vanished path still reports Deleted regardless, because the stat, not
 * the flag, is what decides that.
 *
 * @param root - The directory `change.path` is relative to (the worktree, or an out-of-tree base)
 * @param isTracked - Whether git knows this path, keyed by the same relative path
 * @returns The events to send, empty when no watcher claimed any of them
 */
export function watchedFileChanges(
  registrations: readonly WatcherRegistration[],
  root: string,
  changes: readonly WatchedPathChange[],
  isTracked: (path: string) => boolean,
) {
  return changes.flatMap((change): FileEvent[] => {
    const path = join(root, change.path);
    const mask = watchedKindMask(registrations, path);
    if (mask === 0) {
      return [];
    }
    const event = watchedFileEvent(path, change.renamed && !isTracked(change.path));
    return acceptsKind(mask, event.type)
      ? [{ type: event.type, uri: pathToFileURL(path).href }]
      : [];
  });
}

/**
 * Registered bases that lie outside the worktree: the Python search paths pyright names when the
 * venv is a conda/pyenv/global env rather than an in-repo `.venv`. The worktree watcher never sees
 * these, so each one needs a watch of its own or the server is told nothing about them.
 *
 * Sorted, so the list is a function of the base _set_: the transport announces only a list that
 * moved, and a re-registration naming the same paths in a different order must not read as a change
 * and tear every watch down.
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
