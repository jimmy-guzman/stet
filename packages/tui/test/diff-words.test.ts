import { expect, test } from "bun:test";

import { wordAt, words } from "@/diff/words";

const line = "const user = getUser(id)";
// Words:        const(0-5) user(6-10) getUser(13-20) id(21-23)

test("splits a line into identifier runs, skipping punctuation and spaces", () => {
  expect(words(line)).toEqual([
    { end: 5, start: 0 },
    { end: 10, start: 6 },
    { end: 20, start: 13 },
    { end: 23, start: 21 },
  ]);
});

test("treats unicode letters and digits, _ and $ as identifier characters", () => {
  expect(words("café $x _y2")).toEqual([
    { end: 4, start: 0 },
    { end: 7, start: 5 },
    { end: 11, start: 8 },
  ]);
});

test("keeps an astral identifier glyph whole (no surrogate-pair split)", () => {
  // "x𝐀y": 𝐀 (U+1D400) is a \p{L} letter spanning two UTF-16 units, so the word
  // Runs 0..4 (x=1, 𝐀=2, y=1) rather than breaking on the lone surrogate halves.
  const astral = "x\u{1D400}y";
  expect(words(astral)).toEqual([{ end: 4, start: 0 }]);
  expect(wordAt(astral, 1)).toEqual({ end: 4, start: 0 });
});

test("a blank or whitespace-only line has no words", () => {
  expect(words("   ")).toEqual([]);
  expect(words("")).toEqual([]);
});

test("wordAt returns the owning word, or undefined inside a gap", () => {
  expect(wordAt(line, 0)).toEqual({ end: 5, start: 0 });
  // Mid getUser
  expect(wordAt(line, 15)).toEqual({ end: 20, start: 13 });
  // The space after const
  expect(wordAt(line, 5)).toBeUndefined();
  // The "(" after getUser
  expect(wordAt(line, 20)).toBeUndefined();
  expect(wordAt(line, 99)).toBeUndefined();
});
