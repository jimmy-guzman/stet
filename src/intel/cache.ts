/**
 * A bounded LRU cache for code-intel replies, keyed by request. Repeating a hover or definition on
 * the same caret during a quiet period returns the stored reply instead of a fresh LSP round-trip;
 * a content change invalidates the affected repo (see `Intel.invalidate`). Pure and generic over
 * the reply shape so the service holds one cache per return type (no cast to narrow a heterogeneous
 * value) and unit tests drive it with plain values.
 */

interface IntelCacheKey {
  readonly repoRoot: string;
  readonly path: string;
  readonly line: number;
  readonly character: number;
  readonly method: string;
}

// A null byte never appears in a method, a repo root, or a repo-relative path, so it is an
// Unambiguous field separator: splitting a key back into its fields is exact, which is what
// Invalidation matches on. Method leads so a document-wide pull (documentSymbol, no caret) and a
// Caret pull on the same file can never collide even at the same sentinel position.
const separator = "\0";

export function cacheKey(key: IntelCacheKey): string {
  return [key.method, key.repoRoot, key.path, key.line, key.character].join(separator);
}

export function makeIntelCache<V>(capacity: number) {
  const entries = new Map<string, V>();

  const invalidateBy = (matches: (repoRoot: string, path: string) => boolean) => {
    for (const key of entries.keys()) {
      const [, repoRoot, path] = key.split(separator);
      if (repoRoot !== undefined && path !== undefined && matches(repoRoot, path)) {
        entries.delete(key);
      }
    }
  };

  return {
    clear: () => entries.clear(),
    // Values are non-empty reply arrays, never undefined, so `undefined` unambiguously means a miss.
    get: (key: string) => {
      const value = entries.get(key);
      if (value === undefined) {
        return undefined;
      }
      // Re-insert so the just-read entry is newest in insertion order; eviction drops the oldest.
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    invalidatePath: (repoRoot: string, path: string) =>
      invalidateBy((entryRoot, entryPath) => entryRoot === repoRoot && entryPath === path),
    invalidateRepo: (repoRoot: string) => invalidateBy((entryRoot) => entryRoot === repoRoot),
    set: (key: string, value: V) => {
      entries.delete(key);
      entries.set(key, value);
      while (entries.size > capacity) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) {
          break;
        }
        entries.delete(oldest);
      }
    },
  };
}
