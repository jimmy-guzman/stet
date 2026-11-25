import { describe, expect, test } from "bun:test";

import { placeCard } from "@/viewer/anchor";

// A 40-wide, 20-tall viewport with a 10-wide, 5-tall card.
const cardBase = {
  cardHeight: 5,
  cardWidth: 10,
  viewportHeight: 20,
  viewportWidth: 40,
};

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
    expect(placeCard({ ...cardBase, anchor: { col: 36, row: 2 } }).left).toBe(
      30
    );
  });

  test("clamps the left edge to zero at the left", () => {
    expect(placeCard({ ...cardBase, anchor: { col: 0, row: 2 } }).left).toBe(0);
  });

  test("pins to the left when the card is wider than the viewport", () => {
    expect(
      placeCard({ ...cardBase, anchor: { col: 5, row: 2 }, cardWidth: 50 }).left
    ).toBe(0);
  });

  test("does not flip while the card still fits below", () => {
    // Row 14 + 1 + 5 = 20, exactly the viewport height, so it fits below.
    expect(
      placeCard({ ...cardBase, anchor: { col: 0, row: 14 } }).flipped
    ).toBe(false);
    // Row 15 pushes it to 21, one past, so it flips.
    expect(
      placeCard({ ...cardBase, anchor: { col: 0, row: 15 } }).flipped
    ).toBe(true);
  });
});
