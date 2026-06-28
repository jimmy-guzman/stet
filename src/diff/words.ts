// Pure word model over a line of source text, for the in-line caret. The caret
// Hops word to word (identifier to identifier) rather than character by character,
// And highlights the word it sits on. A "word" is a maximal run of identifier
// Characters; every other character is a gap the caret skips over. Indices are
// UTF-16 string offsets (what LSP `character` positions use), so the caret column
// Maps straight onto a request position. No Solid/OpenTUI/Effect: unit-testable
// Directly, like `git/tree`.

const IDENTIFIER = /[\p{L}\p{N}_$]/u;

export interface Word {
  /** UTF-16 start offset (inclusive). */
  start: number;
  /** UTF-16 end offset (exclusive). */
  end: number;
}

// `\p{L}`/`\p{N}` match per code point; a lone surrogate half (an astral glyph,
// Never a real identifier char) fails the test and reads as a gap, which is fine.
const isIdentifier = (char: string | undefined) => char !== undefined && IDENTIFIER.test(char);

/** Every word in the line, in order. */
export function words(line: string): Word[] {
  const out: Word[] = [];
  let start = -1;
  for (let index = 0; index <= line.length; index += 1) {
    if (isIdentifier(line[index])) {
      if (start === -1) {
        start = index;
      }
    } else if (start !== -1) {
      out.push({ end: index, start });
      start = -1;
    }
  }
  return out;
}

/** Start offsets of each word; the caret always rests on one of these (or 0). */
export function wordStarts(line: string): number[] {
  return words(line).map((word) => word.start);
}

/** The word containing `index`, or undefined when `index` falls in a gap. */
export function wordAt(line: string, index: number): Word | undefined {
  return words(line).find((word) => index >= word.start && index < word.end);
}

/** The next word start strictly after `index`; stays put when there is none. */
export function nextWord(line: string, index: number): number {
  const starts = wordStarts(line);
  return starts.find((start) => start > index) ?? lastAtOrBefore(starts, index) ?? index;
}

/** The previous word start strictly before `index`; stays put when there is none. */
export function prevWord(line: string, index: number): number {
  const starts = wordStarts(line);
  return (
    starts.toReversed().find((start) => start < index) ?? firstAtOrAfter(starts, index) ?? index
  );
}

/** The line's first word start, or 0 for a line with no words (caret home). */
export function firstWord(line: string): number {
  return wordStarts(line)[0] ?? 0;
}

/** The line's last word start, or 0 for a line with no words. */
export function lastWord(line: string): number {
  const starts = wordStarts(line);
  return starts[starts.length - 1] ?? 0;
}

function lastAtOrBefore(starts: number[], index: number) {
  return starts.toReversed().find((start) => start <= index);
}

function firstAtOrAfter(starts: number[], index: number) {
  return starts.find((start) => start >= index);
}
