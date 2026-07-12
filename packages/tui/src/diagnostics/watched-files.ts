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
   * Absolute directory the glob matches relative to: a `RelativePattern`'s base, or the worktree
   * root for a bare glob. `undefined` when the server sent an absolute glob, which matches against
   * the absolute path as-is.
   */
  readonly base: string | undefined;
  readonly glob: Bun.Glob;
}

export interface WatcherRegistration {
  readonly id: string;
  readonly watchers: readonly CompiledWatcher[];
}

const METHOD = "workspace/didChangeWatchedFiles";

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
 */
export function watchedFileEvent(path: string, renamed: boolean): WatchedFileEvent {
  if (!existsSync(path)) {
    return { path, type: 3 };
  }
  return { path, type: renamed ? 1 : 2 };
}

function baseUriString(baseUri: unknown) {
  if (typeof baseUri === "string") {
    return baseUri;
  }
  return isObject(baseUri) && typeof baseUri.uri === "string" ? baseUri.uri : undefined;
}

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

function compileGlob(pattern: unknown, repoRoot: string): CompiledWatcher | undefined {
  // A bare glob is workspace-relative (pyright registers `**` and `**/pyrightconfig.json`); a server
  // That sends an absolute one instead is matched against the absolute path as-is.
  if (typeof pattern === "string") {
    return isAbsolute(pattern)
      ? { base: undefined, glob: new Bun.Glob(pattern) }
      : { base: repoRoot, glob: new Bun.Glob(pattern) };
  }
  if (isObject(pattern) && typeof pattern.pattern === "string") {
    const base = baseDirectory(pattern.baseUri);
    return base === undefined ? undefined : { base, glob: new Bun.Glob(pattern.pattern) };
  }
  return undefined;
}

function compileWatchers(registerOptions: unknown, repoRoot: string) {
  if (!isObject(registerOptions) || !Array.isArray(registerOptions.watchers)) {
    return [];
  }
  return registerOptions.watchers
    .filter(isObject)
    .map((watcher) => compileGlob(watcher.globPattern, repoRoot))
    .filter((watcher) => watcher !== undefined);
}

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

/** The registration ids a `client/unregisterCapability` payload drops. */
export function parseWatcherUnregistrations(params: unknown) {
  if (!isObject(params) || !Array.isArray(params.unregisterations)) {
    return [];
  }
  return params.unregisterations
    .filter(isWatcherRegistration)
    .map((registration) => registration.id);
}

function matchesWatcher(watcher: CompiledWatcher, path: string) {
  if (watcher.base === undefined) {
    return watcher.glob.match(path);
  }
  const within = relative(watcher.base, path);
  // `relative` escapes with `..` (or stays absolute across drives) exactly when the path lies
  // Outside the base, which is the set of paths this watcher did not ask for.
  if (within === "" || within === ".." || within.startsWith(`..${sep}`) || isAbsolute(within)) {
    return false;
  }
  return watcher.glob.match(within);
}

/** Whether any registered watcher asked to hear about this absolute path. */
export function matchesWatchers(registrations: readonly WatcherRegistration[], path: string) {
  return registrations.some((registration) =>
    registration.watchers.some((watcher) => matchesWatcher(watcher, path)),
  );
}

/**
 * Registered bases that lie outside the worktree: the Python search paths pyright names when the
 * venv is a conda/pyenv/global env rather than an in-repo `.venv`. The worktree watcher never sees
 * these, so each one needs a watch of its own or the server is told nothing about them.
 */
export function outOfTreeBases(registrations: readonly WatcherRegistration[], repoRoot: string) {
  return [
    ...new Set(
      registrations
        .flatMap((registration) => registration.watchers)
        .map((watcher) => watcher.base)
        .filter((base) => base !== undefined)
        .filter((base) => base !== repoRoot && !base.startsWith(`${repoRoot}${sep}`)),
    ),
  ];
}
