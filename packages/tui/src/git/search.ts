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

// The pane's filter field as git pathspecs: whitespace-separated globs include,
// A `!` prefix excludes (ripgrep's -g convention, mapped to git's `:(exclude)`),
// And anything else passes verbatim so raw pathspec magic still works. Includes
// Union and excludes subtract; a list of only excludes matches everything else.
export const filterPathspecs = (field: string): string[] | undefined => {
  const tokens = field
    .trim()
    .split(/\s+/u)
    .filter((token) => token !== "" && token !== "!")
    .map((token) =>
      token.startsWith("!") ? `:(exclude)${token.slice(1)}` : token
    );

  return tokens.length === 0 ? undefined : tokens;
};

// `git grep` over working-tree content. `-F` keeps the query literal unless the
// Regex toggle is on (`-E`, the extended dialect IDEs speak); smart-case mirrors
// The in-buffer find unless the case toggle forces sensitivity. `--untracked`
// Widens the search to untracked-but-not-ignored files so it covers the same
// Universe as the tree. A `paths` list scopes the search (changed set or user
// Pathspecs); `undefined` is whole-repo.
export const searchArgs = (
  query: string,
  paths: readonly string[] | undefined,
  options: SearchOptions
) => {
  const smartCase =
    !options.caseSensitive && query === query.toLowerCase() ? ["-i"] : [];

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
};

// With `-n --column -z` each record is `path\0line\0column\0text`, one per line.
// The text is a single source line, so splitting on the first three NULs keeps
// Colons and other delimiters in the matched text intact. `--column` reports a
// 1-based *byte* offset while the caret model speaks UTF-16 code units, so the
// Parse works on raw bytes: slice the prefix at the byte offset (always a match
// Boundary), then decode. Decoding first would let invalid UTF-8 skew the
// Column, since a lone Latin-1 byte is 1 byte to git but a 3-byte replacement
// Char after a string round-trip.
export const parseSearchOutput = (stdout: Uint8Array): SearchMatch[] => {
  const decoder = new TextDecoder();

  return splitRecords(stdout).flatMap((record) => {
    const firstNul = record.indexOf(0);
    const secondNul = firstNul === -1 ? -1 : record.indexOf(0, firstNul + 1);
    const thirdNul = secondNul === -1 ? -1 : record.indexOf(0, secondNul + 1);

    if (thirdNul === -1) {
      return [];
    }

    const lineText = decoder.decode(record.subarray(firstNul + 1, secondNul));
    const columnText = decoder.decode(record.subarray(secondNul + 1, thirdNul));
    const line = lineText === "" ? Number.NaN : Number(lineText);
    const byteColumn = columnText === "" ? Number.NaN : Number(columnText);

    if (Number.isNaN(line) || Number.isNaN(byteColumn)) {
      return [];
    }

    const textBytes = record.subarray(thirdNul + 1);

    return [
      {
        column:
          decoder.decode(textBytes.subarray(0, byteColumn - 1)).length + 1,
        line,
        path: decoder.decode(record.subarray(0, firstNul)),
        text: decoder.decode(textBytes),
      },
    ];
  });
};

/** The `\n` byte. */
const NEWLINE = 0x0a;

const splitRecords = (stdout: Uint8Array) => {
  const records: Uint8Array[] = [];
  let cursor = 0;

  while (cursor < stdout.length) {
    const newline = stdout.indexOf(NEWLINE, cursor);
    const end = newline === -1 ? stdout.length : newline;

    if (end > cursor) {
      records.push(stdout.subarray(cursor, end));
    }

    cursor = end + 1;
  }

  return records;
};
