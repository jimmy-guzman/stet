// Pure word model over a line of source text, for the in-line caret. The caret
// Hops word to word (identifier to identifier) rather than character by character,
// And highlights the word it sits on. A "word" is a maximal run of identifier
// Characters; every other character is a gap the caret skips over. Indices are
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

/** Start offsets of each word; the caret always rests on one of these (or 0). */
export const wordStarts = (line: string): number[] =>
  words(line).map((word) => word.start);

/** The word containing `index`, or undefined when `index` falls in a gap. */
export const wordAt = (line: string, index: number): Word | undefined =>
  words(line).find((word) => index >= word.start && index < word.end);

/** The next word start strictly after `index`; stays put (returns `index`) when there is none. */
export const nextWord = (line: string, index: number): number =>
  wordStarts(line).find((start) => start > index) ?? index;

/** The previous word start strictly before `index`; stays put (returns `index`) when there is none. */
export const prevWord = (line: string, index: number): number =>
  wordStarts(line)
    .toReversed()
    .find((start) => start < index) ?? index;

/** The line's first word start, or 0 for a line with no words (caret home). */
export const firstWord = (line: string): number => wordStarts(line)[0] ?? 0;

/** The line's last word start, or 0 for a line with no words. */
export const lastWord = (line: string): number => {
  const starts = wordStarts(line);
  return starts.at(-1) ?? 0;
};
