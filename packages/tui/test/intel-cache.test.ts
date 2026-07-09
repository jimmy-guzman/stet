import { expect, test } from "bun:test";

import { cacheKey, makeIntelCache } from "@/intel/cache";

const key = (over: Partial<Parameters<typeof cacheKey>[0]> = {}) =>
  cacheKey({
    character: 2,
    line: 4,
    method: "textDocument/definition",
    path: "src/a.ts",
    repoRoot: "/repo",
    ...over,
  });

test("cacheKey is stable for equal requests and distinct across every field", () => {
  expect(key()).toBe(key());
  expect(key({ method: "textDocument/hover" })).not.toBe(key());
  expect(key({ character: 3 })).not.toBe(key());
  expect(key({ line: 5 })).not.toBe(key());
  expect(key({ path: "src/b.ts" })).not.toBe(key());
  expect(key({ repoRoot: "/other" })).not.toBe(key());
  // A document-wide pull (sentinel position) never collides with a caret pull on the same file.
  expect(key({ character: -1, line: -1, method: "textDocument/documentSymbol" })).not.toBe(
    key({ method: "textDocument/documentSymbol" }),
  );
});

test("get returns a stored value and undefined for a miss", () => {
  const cache = makeIntelCache<number[]>(4);
  expect(cache.get("a")).toBeUndefined();
  cache.set("a", [1]);
  expect(cache.get("a")).toEqual([1]);
});

test("eviction drops the oldest entry over capacity, and a read refreshes recency", () => {
  const cache = makeIntelCache<number[]>(2);
  cache.set("a", [1]);
  cache.set("b", [2]);
  // Reading "a" makes it most-recent, so inserting "c" evicts "b" (now oldest), not "a".
  expect(cache.get("a")).toEqual([1]);
  cache.set("c", [3]);
  expect(cache.get("a")).toEqual([1]);
  expect(cache.get("c")).toEqual([3]);
  expect(cache.get("b")).toBeUndefined();
});

test("invalidatePath drops only that file's entries; invalidateRepo drops the whole repo", () => {
  const cache = makeIntelCache<number[]>(16);
  const a = key({ character: 0, line: 0 });
  const aHover = key({ character: 0, line: 0, method: "textDocument/hover" });
  const b = key({ character: 0, line: 0, path: "src/b.ts" });
  const other = key({ character: 0, line: 0, repoRoot: "/other" });
  cache.set(a, [1]);
  cache.set(aHover, [2]);
  cache.set(b, [3]);
  cache.set(other, [4]);

  cache.invalidatePath("/repo", "src/a.ts");
  // Every method for /repo:src/a.ts is gone; the sibling file and the other repo survive.
  expect(cache.get(a)).toBeUndefined();
  expect(cache.get(aHover)).toBeUndefined();
  expect(cache.get(b)).toEqual([3]);
  expect(cache.get(other)).toEqual([4]);

  cache.invalidateRepo("/repo");
  // The whole /repo is gone; /other is untouched.
  expect(cache.get(b)).toBeUndefined();
  expect(cache.get(other)).toEqual([4]);
});

test("clear empties the cache", () => {
  const cache = makeIntelCache<number[]>(4);
  cache.set("a", [1]);
  cache.clear();
  expect(cache.get("a")).toBeUndefined();
});
