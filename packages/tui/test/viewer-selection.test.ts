import { describe, expect, test } from "bun:test";

import {
  followLines,
  moveFocusColumn,
  moveFocusRow,
  selectedLineNumbers,
  selectedRange,
  selectedText,
} from "@/viewer/selection";
import type { Selection } from "@/viewer/selection";

const lines = [
  { content: "const user = load(id);", newLine: 1, oldLine: 1 },
  { content: "", newLine: 2, oldLine: 2 },
  { content: "return 👍🏽;", newLine: 3 },
];

const at = (index: number, column: number) => ({ column, index });

const textOf = (selection: Selection, source = lines) => {
  const range = selectedRange(source, selection);

  return range === undefined ? undefined : selectedText(source, range);
};

const numbers = (
  source: { content: string; newLine?: number; oldLine?: number }[]
) =>
  selectedLineNumbers(source, {
    end: at(source.length - 1, 0),
    start: at(0, 0),
  });

describe("selected text", () => {
  test("includes the glyph at each end, in either direction", () => {
    const forward: Selection = {
      anchor: at(0, 6),
      focus: at(0, 9),
      unit: "character",
    };

    expect(textOf(forward)).toBe("user");
    expect(
      textOf({ ...forward, anchor: forward.focus, focus: forward.anchor })
    ).toBe("user");
  });

  test("spans lines, blank ones included", () => {
    expect(
      textOf({ anchor: at(0, 18), focus: at(2, 5), unit: "character" })
    ).toBe("id);\n\nreturn");
  });

  test("never splits a cluster", () => {
    expect(
      textOf({ anchor: at(2, 7), focus: at(2, 7), unit: "character" })
    ).toBe("👍🏽");
    expect(
      textOf({ anchor: at(2, 9), focus: at(2, 9), unit: "character" })
    ).toBe("👍🏽");
  });

  test("a word grows both ends; a gap is its own glyph", () => {
    expect(textOf({ anchor: at(0, 7), focus: at(0, 7), unit: "word" })).toBe(
      "user"
    );
    expect(textOf({ anchor: at(0, 14), focus: at(0, 7), unit: "word" })).toBe(
      "user = load"
    );
    expect(textOf({ anchor: at(0, 17), focus: at(0, 17), unit: "word" })).toBe(
      "("
    );
  });

  test("lines ignore columns", () => {
    expect(textOf({ anchor: at(1, 0), focus: at(0, 9), unit: "line" })).toBe(
      "const user = load(id);\n"
    );
  });

  test("endpoints that clamp onto one line stay in order", () => {
    expect(
      textOf({ anchor: at(2, 0), focus: at(0, 4), unit: "character" }, [
        { content: "abcdef", newLine: 1, oldLine: 1 },
      ])
    ).toBe("abcde");
  });

  test("a selection outliving its lines is clamped to what is left", () => {
    expect(
      textOf({ anchor: at(0, 0), focus: at(40, 90), unit: "character" })
    ).toBe("const user = load(id);\n\nreturn 👍🏽;");
    expect(
      textOf({ anchor: at(0, 0), focus: at(1, 0), unit: "line" }, [])
    ).toBeUndefined();
  });
});

describe("reference lines", () => {
  test("names the new side across a change", () => {
    expect(
      numbers([
        { content: "a", newLine: 10, oldLine: 4 },
        { content: "b", oldLine: 5 },
        { content: "c", newLine: 11 },
      ])
    ).toEqual({ endLine: 11, line: 10 });
  });

  test("names the old side when every line was removed", () => {
    expect(
      numbers([
        { content: "a", oldLine: 5 },
        { content: "b", oldLine: 6 },
      ])
    ).toEqual({ endLine: 6, line: 5 });
  });
});

describe("moving the focus", () => {
  const user: Selection = {
    anchor: at(0, 6),
    focus: at(0, 9),
    unit: "character",
  };

  test("a column moves one glyph and stops at the line's ends", () => {
    expect(textOf(moveFocusColumn(lines, user, 1))).toBe("user ");
    expect(textOf(moveFocusColumn(lines, user, -1))).toBe("use");

    const last: Selection = { ...user, focus: at(0, 21) };
    expect(textOf(moveFocusColumn(lines, last, 1))).toBe("user = load(id);");

    const first: Selection = { ...user, focus: at(0, 0) };
    expect(textOf(moveFocusColumn(lines, first, -1))).toBe("const u");
  });

  test("a focus dragged past the line's end steps back over its last glyph", () => {
    const past: Selection = { ...user, focus: at(0, 22) };
    expect(textOf(moveFocusColumn(lines, past, -1))).toBe("user = load(id)");
  });

  test("a word selection continues by character from its own ends", () => {
    const word: Selection = {
      anchor: at(0, 7),
      focus: at(0, 7),
      unit: "word",
    };

    expect(textOf(moveFocusColumn(lines, word, 1))).toBe("user ");
  });

  test("a line selection has no column to move", () => {
    const whole: Selection = { ...user, unit: "line" };
    expect(moveFocusColumn(lines, whole, 1)).toBe(whole);
  });

  test("a row keeps its column across a shorter line, and stops at the ends", () => {
    const down = moveFocusRow(lines, user, 1);
    expect(textOf(down)).toBe("user = load(id);\n");
    expect(textOf(moveFocusRow(lines, down, 1))).toBe(
      "user = load(id);\n\nreturn 👍🏽"
    );
    expect(moveFocusRow(lines, user, -1).focus).toEqual(user.focus);
  });

  test("a row moved past the first keeps the anchor's glyph", () => {
    const up = moveFocusRow(lines, { ...user, anchor: at(2, 0) }, -1);
    expect(textOf(up)).toBe("r = load(id);\n\nr");
  });
});

const text = (...contents: string[]) =>
  contents.map((content) => ({ content }));

const rows = (selection: Selection | undefined) =>
  selection === undefined
    ? undefined
    : [selection.anchor.index, selection.focus.index];

describe("following a refresh", () => {
  const old = text("a", "b", "c", "d", "e");

  const onB: Selection = {
    anchor: at(1, 0),
    focus: at(1, 0),
    unit: "character",
  };

  test("text before the first change stays", () => {
    expect(followLines(old, text("a", "b", "x", "d", "e"), onB)).toBe(onB);
  });

  test("text after the last change moves with the length, duplicates aside", () => {
    const braces = text("}", "a", "}", "b");
    const second: Selection = { ...onB, anchor: at(2, 0), focus: at(2, 0) };
    expect(
      rows(followLines(braces, text("}", "new", "}", "a", "}", "b"), second))
    ).toEqual([4, 4]);
  });

  test("text between two changes is found", () => {
    expect(
      rows(followLines(old, text("x", "y", "a", "b", "c", "z"), onB))
    ).toEqual([3, 3]);
  });

  test("an edited or removed line takes the selection with it", () => {
    expect(
      followLines(old, text("a", "B", "c", "d", "e"), onB)
    ).toBeUndefined();
    expect(followLines(old, text("a", "c", "d", "e"), onB)).toBeUndefined();
  });

  test("a backward selection keeps its direction", () => {
    const backward: Selection = { ...onB, anchor: at(2, 0), focus: at(1, 0) };
    expect(
      rows(followLines(old, text("new", "a", "b", "c", "d", "e"), backward))
    ).toEqual([3, 2]);
  });
});
