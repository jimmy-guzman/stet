/**
 * Where a smart-case substring match starts in a line, or -1: case-insensitive unless the query
 * carries an uppercase character, matching the convention every modern editor's find uses.
 */
export const matchColumn = (line: string, query: string) =>
  query === query.toLowerCase()
    ? line.toLowerCase().indexOf(query)
    : line.indexOf(query);

export const findMatches = (
  lines: readonly string[],
  query: string
): number[] =>
  query === ""
    ? []
    : lines.flatMap((line, index) =>
        matchColumn(line, query) === -1 ? [] : [index]
      );
