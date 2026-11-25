// Pure word model over a line of source text, for a double-click and for scrolling a match into
// View. A "word" is a maximal run of identifier characters. Indices are
// UTF-16 string offsets, the same unit as JavaScript string indexing. No Solid/OpenTUI/Effect: unit-testable
// Directly, like `git/tree`.

const IDENTIFIER = /[\p{L}\p{N}_$]/u;

export interface Word {
  /** UTF-16 start offset (inclusive). */
  start: number;
  /** UTF-16 end offset (exclusive). */
  end: number;
}

/** Every word in the line, in order. */
export const words = (line: string): Word[] => {
  const out: Word[] = [];
  let start = -1;
  // Iterate by code point (`\p{L}`/`\p{N}` are per code point) while tracking the
  // UTF-16 offset, so an astral identifier glyph counts as one character and the
  // Returned offsets stay UTF-16 indices.
  let index = 0;

  for (const char of line) {
    if (IDENTIFIER.test(char)) {
      if (start === -1) {
        start = index;
      }
    } else if (start !== -1) {
      out.push({ end: index, start });
      start = -1;
    }

    index += char.length;
  }

  if (start !== -1) {
    out.push({ end: index, start });
  }

  return out;
};

/** The word containing `index`, or undefined when `index` falls in a gap. */
export const wordAt = (line: string, index: number): Word | undefined =>
  words(line).find((word) => index >= word.start && index < word.end);
