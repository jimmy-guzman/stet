import { toCodePoints } from "./text";

export interface RankOptions {
  lastChangedAt: Map<string, number>;
  changed: Set<string>;
  limit: number;
}

// Which ascii letters/digits/hyphens a string contains, one slot each: letters
// Count 0/1/2-or-more (saturating), digits and the hyphen only presence.
// Comparing bags slot by slot rejects most non-matching candidates before the
// Real O(query * path) scan below ever runs. Never false-rejects a real
// Match: a bag can only under-count (saturating at 2), never over-count.
const BAG_DIGITS = 26;
const BAG_HYPHEN = 36;
const BAG_SIZE = 37;

const buildCharBag = (chars: string[]) => {
  const bag = new Uint8Array(BAG_SIZE);
  for (const raw of chars) {
    const char = raw.toLowerCase();
    const code = char.codePointAt(0) ?? 0;
    if (char >= "a" && char <= "z") {
      bag[code - 97] = Math.min(bag[code - 97] + 1, 2);
    } else if (char >= "0" && char <= "9") {
      bag[BAG_DIGITS + code - 48] = 1;
    } else if (char === "-") {
      bag[BAG_HYPHEN] = 1;
    }
  }
  return bag;
};

const bagIsSuperset = (candidate: Uint8Array, query: Uint8Array) => {
  for (let slot = 0; slot < BAG_SIZE; slot += 1) {
    if (candidate[slot] < query[slot]) {
      return false;
    }
  }
  return true;
};

// Splits a query into whitespace-separated terms: every term must
// Independently match somewhere in the path (AND, any relative order), so
// "agents keymap" finds ".agents/.../keymap/core.mdx". Deliberately no
// Backslash-escape for a literal space inside one term, and no quote/anchor/
// Negation modifiers — just plain per-term fuzzy matching.
const queryTerms = (query: string): string[] =>
  query.split(/\s+/u).filter((term) => term.length > 0);

// Requires every prepared term to score > 0 against the candidate (the same
// Gate `fuzzyMatch` used for a single term), short-circuiting on the first
// Failure, and sums the passing scores so a query that matches more terms,
// Or matches them better, ranks higher.
const matchPreparedTerms = (
  prepared: QueryPrep[],
  candidate: Candidate
): number | undefined => {
  if (prepared.length === 0) {
    return 0;
  }

  let total = 0;
  for (const term of prepared) {
    if (!bagIsSuperset(candidate.bag, term.bag)) {
      return undefined;
    }

    const score = scorePath(term, candidate);
    if (score <= 0) {
      return undefined;
    }

    total += score;
  }

  return total;
};

interface QueryPrep {
  original: string[];
  lower: string[];
  bag: Uint8Array;
  smartCase: boolean;
}

const prepareQuery = (query: string): QueryPrep => {
  const original = toCodePoints(query);
  const lower = original.map((char) => char.toLowerCase());
  return {
    bag: buildCharBag(lower),
    lower,
    original,
    smartCase: original.some((char) => char !== char.toLowerCase()),
  };
};

interface Candidate {
  chars: string[];
  lower: string[];
  bag: Uint8Array;
}

// Well above any repo this app targets (100k files), so a session never
// Evicts its current file set — only stale entries from paths renamed or
// Deleted since the process started, which would otherwise accumulate
// Forever (this module has no reload hook to clear them on a file-set change).
const CANDIDATE_CACHE_LIMIT = 200_000;

const candidateCache = new Map<string, Candidate>();

const candidateFor = (path: string): Candidate => {
  const cached = candidateCache.get(path);
  if (cached !== undefined) {
    return cached;
  }

  const chars = toCodePoints(path);
  const lower = chars.map((char) => char.toLowerCase());
  const candidate = { bag: buildCharBag(lower), chars, lower };

  if (candidateCache.size >= CANDIDATE_CACHE_LIMIT) {
    const oldestPath = candidateCache.keys().next().value;
    if (oldestPath !== undefined) {
      candidateCache.delete(oldestPath);
    }
  }
  candidateCache.set(path, candidate);
  return candidate;
};

// The last position each query char could occupy while leaving enough room
// For the remaining query chars to still match; bounds the DP scan below and
// Doubles as a subsequence existence check (undefined when infeasible).
const findLastPositions = (
  queryLower: string[],
  pathLower: string[]
): number[] | undefined => {
  const positions = Array.from<number>({ length: queryLower.length });
  let end = pathLower.length;

  for (let i = queryLower.length - 1; i >= 0; i -= 1) {
    const char = queryLower[i];
    let found = -1;
    for (let j = end - 1; j >= 0; j -= 1) {
      if (pathLower[j] === char) {
        found = j;
        break;
      }
    }
    if (found === -1) {
      return undefined;
    }
    positions[i] = found;
    end = found;
  }

  return positions;
};

// The rightmost start index where `needle` occurs contiguously in `haystack`,
// Or -1. Rightmost so a term is highlighted on its basename occurrence, not an
// Earlier parent-directory one.
const lastSubsequenceRun = (haystack: string[], needle: string[]): number => {
  for (let start = haystack.length - needle.length; start >= 0; start -= 1) {
    if (needle.every((char, offset) => haystack[start + offset] === char)) {
      return start;
    }
  }
  return -1;
};

// The matched character offsets (ascending, deduped) for highlighting a result
// And keeping the match visible when its path is truncated. Runs each
// Whitespace term independently and unions their positions, mirroring the
// Ranker's per-term AND. A term is matched as a contiguous run when it appears
// As one (the common case: typing a real path fragment), which keeps the
// Highlight tight and preferring the rightmost run keeps it on the basename;
// It falls back to the scattered subsequence alignment only when the term is
// Not contiguous. Returns [] for an empty or non-matching query.
export const matchIndices = (query: string, text: string): number[] => {
  const terms = queryTerms(query);
  if (terms.length === 0) {
    return [];
  }

  const textLower = toCodePoints(text).map((char) => char.toLowerCase());
  const matched = new Set<number>();
  for (const term of terms) {
    const termLower = toCodePoints(term).map((char) => char.toLowerCase());
    const run = lastSubsequenceRun(textLower, termLower);
    if (run >= 0) {
      for (let offset = 0; offset < termLower.length; offset += 1) {
        matched.add(run + offset);
      }
      continue;
    }
    const positions = findLastPositions(termLower, textLower);
    if (positions === undefined) {
      return [];
    }
    for (const position of positions) {
      matched.add(position);
    }
  }

  return [...matched].toSorted((a, b) => a - b);
};

const BASE_DISTANCE_PENALTY = 0.6;
const ADDITIONAL_DISTANCE_PENALTY = 0.05;
const MIN_DISTANCE_PENALTY = 0.2;

const isLowercaseLetter = (char: string) =>
  char.toLowerCase() === char && char.toUpperCase() !== char;

const isUppercaseLetter = (char: string) =>
  char.toUpperCase() === char && char.toLowerCase() !== char;

const isDigit = (char: string) => char >= "0" && char <= "9";

/**
 * The score for matching path char `j` when the scan for this query char started at `pathIndex`:
 * 1 for a consecutive run, a bonus after a separator/case-transition/dot, and otherwise a distance
 * penalty that grows with the gap.
 */
const positionScore = (
  chars: string[],
  j: number,
  pathIndex: number,
  queryIndex: number
) => {
  if (j <= pathIndex) {
    return 1;
  }
  const last = chars[j - 1];
  if (last === "/") {
    return 0.9;
  }
  if (
    last === "-" ||
    last === "_" ||
    last === " " ||
    isDigit(last) ||
    (isLowercaseLetter(last) && isUppercaseLetter(chars[j]))
  ) {
    return 0.8;
  }
  if (last === ".") {
    return 0.7;
  }
  if (queryIndex === 0) {
    return BASE_DISTANCE_PENALTY;
  }
  return Math.max(
    MIN_DISTANCE_PENALTY,
    BASE_DISTANCE_PENALTY - (j - pathIndex - 1) * ADDITIONAL_DISTANCE_PENALTY
  );
};

// A greedy left-to-right scan commits to the first plausible alignment and
// Can miss a better one (e.g. it can pick the stray "c" in "src" over the
// Real "cli" match); this instead searches every alignment via memoized
// Recursion and keeps the highest-scoring one. Score is the product of
// Per-character scores: 1.0 for a char immediately following the previous
// Match (a consecutive run), tapering bonuses for matches right after a
// Separator/case-transition/dot, and a distance penalty that decays with gap
// Size otherwise. The very first query char is additionally scaled down by
// How deep into the path it was found, so a basename hit outranks the same
// Letters scattered through parent directories.
const scorePath = (query: QueryPrep, candidate: Candidate): number => {
  const found = findLastPositions(query.lower, candidate.lower);
  if (found === undefined) {
    return 0;
  }
  // Rebound with an explicit non-nullable type: `found` narrows here, but TS
  // Does not carry that narrowing into the nested `recurse` closure below.
  const lastPositions: number[] = found;

  const pathLength = candidate.chars.length;
  const memo = Array.from<number | undefined>({
    length: query.lower.length * pathLength,
  });

  const recurse = (queryIndex: number, pathIndex: number): number => {
    if (queryIndex === query.lower.length) {
      return 1;
    }

    const safeLimit = Math.min(lastPositions[queryIndex], pathLength - 1);
    if (pathIndex > safeLimit) {
      return 0;
    }

    const memoKey = queryIndex * pathLength + pathIndex;
    const memoized = memo[memoKey];
    if (memoized !== undefined) {
      return memoized;
    }

    const queryChar = query.lower[queryIndex];
    let score = 0;
    let lastSlash = 0;

    for (let j = pathIndex; j <= safeLimit; j += 1) {
      const pathChar = candidate.lower[j];
      const isSeparator = pathChar === "/";
      if (queryIndex === 0 && isSeparator) {
        lastSlash = j;
      }

      if (pathChar !== queryChar && !(isSeparator && queryChar === "_")) {
        continue;
      }

      const curr = candidate.chars[j];
      let charScore = positionScore(candidate.chars, j, pathIndex, queryIndex);

      if (
        (query.smartCase || curr === "/") &&
        query.original[queryIndex] !== curr
      ) {
        charScore *= 0.001;
      }

      const multiplier =
        queryIndex === 0 ? charScore / (pathLength - lastSlash) : charScore;
      const branchScore = recurse(queryIndex + 1, j + 1) * multiplier;
      if (branchScore > score) {
        score = branchScore;
        if (branchScore === 1) {
          break;
        }
      }
    }

    memo[memoKey] = score;
    return score;
  };

  return recurse(0, 0) * query.lower.length;
};

export const fuzzyMatch = (query: string, path: string): number | undefined => {
  const terms = queryTerms(query);
  if (terms.length === 0) {
    return 0;
  }

  return matchPreparedTerms(terms.map(prepareQuery), candidateFor(path));
};

export const rankFiles = (
  query: string,
  paths: string[],
  options: RankOptions
): string[] => {
  const terms = queryTerms(query);
  if (terms.length === 0) {
    return topK(paths, options.limit, (a, b) => {
      const recencyDelta =
        (options.lastChangedAt.get(b) ?? 0) -
        (options.lastChangedAt.get(a) ?? 0);
      if (recencyDelta !== 0) {
        return recencyDelta;
      }

      const changedDelta =
        (options.changed.has(b) ? 1 : 0) - (options.changed.has(a) ? 1 : 0);
      if (changedDelta !== 0) {
        return changedDelta;
      }

      return a.localeCompare(b);
    });
  }

  const prepared = terms.map(prepareQuery);

  return paths
    .flatMap((path) => {
      const score = matchPreparedTerms(prepared, candidateFor(path));
      return score === undefined ? [] : [{ path, score }];
    })
    .toSorted((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, options.limit)
    .map((match) => match.path);
};

/**
 * The first `limit` items of `[...items].toSorted(compare)` without sorting the whole input:
 * bounded insertion into a limit-sized sorted prefix, with a fast reject once full. The picker's
 * empty-query path runs this over every repo path on open, where a full sort is the dominant cost.
 * Ties insert after existing equals, matching toSorted's stability.
 */
const topK = <T>(
  items: T[],
  limit: number,
  compare: (a: T, b: T) => number
): T[] => {
  const top: T[] = [];
  for (const item of items) {
    if (top.length === limit) {
      const last = top[limit - 1];
      if (last === undefined || compare(item, last) >= 0) {
        continue;
      }
    }
    let low = 0;
    let high = top.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (compare(item, top[mid]) < 0) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }
    top.splice(low, 0, item);
    if (top.length > limit) {
      top.pop();
    }
  }
  return top;
};
