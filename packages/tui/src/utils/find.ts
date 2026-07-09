// Smart-case substring search: case-insensitive unless the query carries an
// Uppercase character, matching the convention every modern editor's find uses.
export function findMatches(lines: readonly string[], query: string): number[] {
  if (query === "") {
    return [];
  }
  const caseSensitive = query !== query.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  return lines.flatMap((line, index) =>
    (caseSensitive ? line : line.toLowerCase()).includes(needle) ? [index] : [],
  );
}
