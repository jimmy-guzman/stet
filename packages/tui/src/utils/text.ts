// Split into Unicode code points (not UTF-16 code units), so an astral char
// Stays one entry. oxlint forbids both string spread and Array.from(string), so
// The split is an explicit iteration (the same idiom the fuzzy matcher uses).
export function toCodePoints(text: string): string[] {
  const chars: string[] = [];
  for (const char of text) {
    chars.push(char);
  }
  return chars;
}

export function truncate(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function truncateLeft(text: string, max: number) {
  if (text.length <= max) {
    return text;
  }
  if (max <= 1) {
    return max === 1 ? "…" : "";
  }
  return `…${text.slice(text.length - (max - 1))}`;
}

// Truncate `text` to `max` cells while keeping every matched character (offsets
// Into the code points of `text`) visible, so a fuzzy match is never hidden.
// Prefers the tail (the filename), and only shifts the window toward an earlier
// Match when that match would otherwise be clipped. Returns the display string
// (a leading/trailing … marks each clipped side) and the matched offsets
// Remapped into that display string, so a caller can highlight them.
export function truncateAroundMatch(text: string, matched: number[], max: number) {
  const chars = toCodePoints(text);
  if (chars.length <= max) {
    return { matched, text };
  }
  if (max <= 1) {
    return { matched: [], text: max === 1 ? "…" : "" };
  }

  const window = (start: number, end: number, lead: boolean, trail: boolean) => {
    const prefix = lead ? "…" : "";
    return {
      matched: matched
        .filter((index) => index >= start && index < end)
        .map((index) => index - start + prefix.length),
      text: `${prefix}${chars.slice(start, end).join("")}${trail ? "…" : ""}`,
    };
  };

  // Tail-anchored: keep the filename end and drop the head. Used as-is when
  // There is no match to preserve, or when the match already sits in that tail.
  const tailStart = chars.length - (max - 1);
  const firstMatch = matched[0];
  if (firstMatch === undefined || firstMatch >= tailStart) {
    return window(tailStart, chars.length, true, false);
  }

  // The match sits before the tail window, so the head is clipped. Cover the
  // Whole matched span when it fits the budget; when the span is wider than the
  // Window (e.g. two terms matched far apart, a leading dir and the basename),
  // Keep its basename-side end visible rather than its head, since that is the
  // More identifying match.
  const lastMatch = matched[matched.length - 1];
  const inner = max - 2;
  const start = lastMatch - firstMatch < inner ? firstMatch : lastMatch + 1 - inner;
  const lead = start > 0;
  const end = start + max - (lead ? 1 : 0) - 1;
  return window(start, end, lead, end < chars.length);
}

export function truncateName(name: string, max: number) {
  if (name.length <= max) {
    return name;
  }
  if (max <= 1) {
    return max === 1 ? "…" : "";
  }
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot) : "";
  const keep = max - 1 - ext.length;
  if (keep <= 0) {
    return `${name.slice(0, max - 1)}…`;
  }
  return `${name.slice(0, keep)}…${ext}`;
}

export function collapseHome(path: string) {
  const home = Bun.env.HOME;
  if (home === undefined || home === "") {
    return path;
  }
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}
