import { describe, expect, test } from "bun:test";

import { testRender } from "@opentui/solid";

import { App } from "@/App";

import { createFixtureRepo, loadModel, makeSettleUntil, seedState } from "./helpers";

// The windowed lists mount only their visible slice, so the scroll indicator is
// Hand-drawn: a width-1 thumb column derived from (rowCount, viewport, scrollTop).
// These pin the behavior it must have: a thumb appears only when the list
// Overflows, and it tracks the scroll position downward.
describe("list scrollbar", () => {
  const thumbRow = (frame: string) =>
    frame
      .split("\n")
      .map((line) => line.split("││")[0])
      .findIndex((line) => line.includes("▐"));

  test("shows a thumb only when the tree overflows, and it tracks scroll", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 300; i += 1) {
      files[`big/f${String(i).padStart(3, "0")}.txt`] = `content ${i}\n`;
    }
    const repoRoot = createFixtureRepo("sideye-scrollbar-", files);
    const scope = { kind: "all", ref: "HEAD" } as const;
    const model = await loadModel(repoRoot, scope);
    seedState(model, scope);

    const { renderer, mockInput, renderOnce, captureCharFrame } = await testRender(() => <App />, {
      height: 16,
      width: 90,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });
    await settleUntil("first render", (current) => current.includes("f000.txt"));

    // The 300-file directory far exceeds the ~10-row sidebar viewport, so the
    // Thumb paints near the top.
    const topRow = thumbRow(captureCharFrame());
    expect(topRow).toBeGreaterThanOrEqual(0);

    // Scrolling deep into the directory moves the thumb strictly downward.
    for (let i = 0; i < 80; i += 1) {
      mockInput.pressKey("j");
      // oxlint-disable-next-line no-await-in-loop -- sequential nav steps
      await renderOnce();
    }
    await renderOnce();
    expect(thumbRow(captureCharFrame())).toBeGreaterThan(topRow);

    // Collapsing the directory leaves fewer rows than the viewport: the column
    // Stays reserved but paints no thumb.
    for (let i = 0; i < 90; i += 1) {
      mockInput.pressKey("k");
      // oxlint-disable-next-line no-await-in-loop -- sequential nav steps
      await renderOnce();
    }
    mockInput.pressKey("h");
    await renderOnce();
    await renderOnce();
    expect(thumbRow(captureCharFrame())).toBe(-1);

    renderer.destroy();
  });
});
