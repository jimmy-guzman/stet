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

/**
 * The directory an absolute glob is rooted at: its leading components up to the first wildcard.
 * This is what turns `/opt/pyenv/versions/3.14/lib/**` into a base that can actually be _watched_,
 * rather than a pattern that only ever gets matched against events some other watcher happened to
 * deliver.
 */
function literalPrefix(pattern: string) {
  const parts = pattern.split(sep);
  const wildcard = parts.findIndex((part) => /[*?{}[\]]/.test(part));
  return (wildcard === -1 ? parts.slice(0, -1) : parts.slice(0, wildcard)).join(sep) || sep;
}

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

/** Whether any registered watcher asked to hear about this change. */
export function matchesWatchers(
  registrations: readonly WatcherRegistration[],
  event: WatchedFileEvent,
) {
  return registrations.some((registration) =>
    registration.watchers.some((watcher) => matchesWatcher(watcher, event)),
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
        .filter((base) => base !== repoRoot && !base.startsWith(`${repoRoot}${sep}`)),
    ),
  ];
}
