export interface SearchMatch {
  path: string;
  line: number;
  column: number;
  text: string;
}

export interface SearchOptions {
  regex: boolean;
  caseSensitive: boolean;
}

// `git grep` over working-tree content. `-F` keeps the query literal unless the
// Regex toggle is on (`-E`, the extended dialect IDEs speak); smart-case mirrors
// The in-buffer find unless the case toggle forces sensitivity. `--untracked`
// Widens the search to untracked-but-not-ignored files so it covers the same
// Universe as the tree. A `paths` list scopes the search (changed set or user
// Pathspecs); `undefined` is whole-repo.
export function searchArgs(
  query: string,
  paths: readonly string[] | undefined,
  options: SearchOptions,
) {
  const smartCase = !options.caseSensitive && query === query.toLowerCase() ? ["-i"] : [];
  return [
    "git",
    "grep",
    "--no-color",
    "-I",
    "-n",
    "--column",
    "-z",
    options.regex ? "-E" : "-F",
    "--untracked",
    ...smartCase,
    "-e",
    query,
    ...(paths === undefined ? [] : ["--", ...paths]),
  ];
}

// With `-n --column -z` each record is `path\0line\0column\0text`, one per line.
// The text is a single source line, so splitting on the first three NULs keeps
// Colons and other delimiters in the matched text intact. `--column` reports a
// 1-based *byte* offset; the caret model speaks UTF-16 code units, so re-measure
// The prefix through a UTF-8 round-trip (the offset always lands on a character
// Boundary, the start of the match).
export function parseSearchOutput(stdout: string): SearchMatch[] {
  return stdout
    .split("\n")
    .filter((record) => record !== "")
    .flatMap((record) => {
      const firstNul = record.indexOf("\0");
      const secondNul = record.indexOf("\0", firstNul + 1);
      const thirdNul = record.indexOf("\0", secondNul + 1);
      if (firstNul === -1 || secondNul === -1 || thirdNul === -1) {
        return [];
      }
      const line = Number.parseInt(record.slice(firstNul + 1, secondNul), 10);
      const byteColumn = Number.parseInt(record.slice(secondNul + 1, thirdNul), 10);
      if (Number.isNaN(line) || Number.isNaN(byteColumn)) {
        return [];
      }
      const text = record.slice(thirdNul + 1);
      return [
        {
          column: utf16Column(text, byteColumn),
          line,
          path: record.slice(0, firstNul),
          text,
        },
      ];
    });
}

function utf16Column(text: string, byteColumn: number) {
  return (
    Buffer.from(text, "utf8")
      .subarray(0, byteColumn - 1)
      .toString("utf8").length + 1
  );
}
