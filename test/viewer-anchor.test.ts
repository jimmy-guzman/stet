import { describe, expect, test } from "bun:test";

import { caretCell, placeCard } from "@/viewer/anchor";

// An 80-wide, 20-row viewport, content offset 6 cells left of the text (a 5-wide
// Gutter plus the diff sign).
const anchorBase = { contentLeft: 6, scrollX: 0, viewportHeight: 20, viewportWidth: 80 };

describe("caretCell", () => {
  test("maps an on-screen caret to its content-area cell", () => {
    // Row 8 (cursorTop) with no scroll lands on viewport row 8; a word starting at
    // Display column 12 lands at content-left 6 + 12 = column 18.
    expect(caretCell({ ...anchorBase, caretFrom: 12, cursorTop: 8, scrollTop: 0 })).toEqual({
      col: 18,
      row: 8,
    });
  });

  test("subtracts the scroll offsets from row and column", () => {
    expect(
      caretCell({ ...anchorBase, caretFrom: 30, cursorTop: 40, scrollTop: 35, scrollX: 10 }),
    ).toEqual({ col: 26, row: 5 });
  });

  test("returns undefined when the caret row is above the fold", () => {
    expect(caretCell({ ...anchorBase, caretFrom: 0, cursorTop: 4, scrollTop: 10 })).toBeUndefined();
  });

  test("returns undefined when the caret row is past the bottom", () => {
    // CursorTop 30, scrollTop 5 -> row 25, beyond the 20-row viewport.
    expect(caretCell({ ...anchorBase, caretFrom: 0, cursorTop: 30, scrollTop: 5 })).toBeUndefined();
  });

  test("includes the last visible row but excludes the row just past it", () => {
    expect(caretCell({ ...anchorBase, caretFrom: 0, cursorTop: 19, scrollTop: 0 })?.row).toBe(19);
    expect(caretCell({ ...anchorBase, caretFrom: 0, cursorTop: 20, scrollTop: 0 })).toBeUndefined();
  });

  test("returns undefined when the caret is scrolled off the left edge", () => {
    // CaretFrom 2, scrollX 5 -> col 6 + 2 - 5 = 3, left of the content (contentLeft 6).
    expect(
      caretCell({ ...anchorBase, caretFrom: 2, cursorTop: 8, scrollTop: 0, scrollX: 5 }),
    ).toBeUndefined();
  });

  test("returns undefined when the caret is scrolled past the right edge", () => {
    // In a 20-wide viewport, a word at display column 30 sits well past the right edge.
    expect(
      caretCell({ ...anchorBase, caretFrom: 30, cursorTop: 8, scrollTop: 0, viewportWidth: 20 }),
    ).toBeUndefined();
  });
});

// A 40-wide, 20-tall viewport with a 10-wide, 5-tall card.
const cardBase = { cardHeight: 5, cardWidth: 10, viewportHeight: 20, viewportWidth: 40 };

describe("placeCard", () => {
  test("places the card on the row below the caret", () => {
    const placement = placeCard({ ...cardBase, anchor: { col: 4, row: 8 } });
    expect(placement).toEqual({ flipped: false, left: 4, top: 9 });
  });

  test("flips above the caret when it would overflow the bottom", () => {
    // Row 18 + 1 below + 5 tall = 24 > 20, so flip to end just above the caret.
    expect(placeCard({ ...cardBase, anchor: { col: 4, row: 18 } })).toEqual({
      flipped: true,
      left: 4,
      top: 13,
    });
  });

  test("clamps the left edge so the card stays on screen at the right", () => {
    // Caret column 36 + 10-wide card would run to 46; clamp left to 30.
    expect(placeCard({ ...cardBase, anchor: { col: 36, row: 2 } }).left).toBe(30);
  });

  test("clamps the left edge to zero at the left", () => {
    expect(placeCard({ ...cardBase, anchor: { col: 0, row: 2 } }).left).toBe(0);
  });

  test("pins to the left when the card is wider than the viewport", () => {
    expect(placeCard({ ...cardBase, anchor: { col: 5, row: 2 }, cardWidth: 50 }).left).toBe(0);
  });

  test("does not flip while the card still fits below", () => {
    // Row 14 + 1 + 5 = 20, exactly the viewport height, so it fits below.
    expect(placeCard({ ...cardBase, anchor: { col: 0, row: 14 } }).flipped).toBe(false);
    // Row 15 pushes it to 21, one past, so it flips.
    expect(placeCard({ ...cardBase, anchor: { col: 0, row: 15 } }).flipped).toBe(true);
  });
});
