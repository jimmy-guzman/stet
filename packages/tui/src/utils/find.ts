// Lowercasing can lengthen a character, so an offset into the lowered line is walked back to the
// Character it came from.
const originalOffset = (line: string, lowered: number) => {
  let from = 0;
  let to = 0;

  for (const char of line) {
    from += char.toLowerCase().length;

    if (from > lowered) {
      return to;
    }

    to += char.length;
  }

  return to;
};

/**
 * Where a smart-case substring match starts in a line, or -1: case-insensitive unless the query
 * carries an uppercase character, matching the convention every modern editor's find uses.
 */
export const matchColumn = (line: string, query: string) => {
  if (query !== query.toLowerCase()) {
    return line.indexOf(query);
  }

  const lowered = line.toLowerCase();
  const at = lowered.indexOf(query);

  return at === -1 || lowered.length === line.length
    ? at
    : originalOffset(line, at);
};

export const findMatches = (
  lines: readonly string[],
  query: string
): number[] =>
  query === ""
    ? []
    : lines.flatMap((line, index) =>
        matchColumn(line, query) === -1 ? [] : [index]
      );
