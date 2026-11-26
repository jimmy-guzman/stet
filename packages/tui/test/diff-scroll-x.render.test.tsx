import { expect, test } from "bun:test";

import { testRender } from "@opentui/solid";

import { App } from "@/app";
import { state } from "@/state";

import {
  createFixtureRepo,
  loadModel,
  makeSettleUntil,
  seedState,
} from "./helpers";

const scope = { kind: "all", ref: "HEAD" } as const;

// The code beside each line's gutter (change bar, digit, space).
const code = (frame: string) => {
  const { x, y } = state.layout().viewer.content;

  return frame
    .split("\n")
    .slice(y + 1, y + 5)
    .map((row) => row.slice(x + 3).trimEnd());
};

test("scrolling sideways moves every line by the same cells, short and wide ones too", async () => {
  const repoRoot = createFixtureRepo("stet-scroll-x-", {
    "a.ts": [
      `0123456789${"-".repeat(200)}`,
      "abc",
      "\tif tabbed",
      "漢字漢字 wide",
      "",
    ].join("\n"),
  });

  seedState(await loadModel(repoRoot, scope), scope);

  const { captureCharFrame, renderOnce, renderer } = await testRender(
    () => <App />,
    { height: 16, width: 80 }
  );

  const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

  try {
    await settleUntil("loaded", (frame) => frame.includes("0123456789"));
    expect(code(captureCharFrame())[1]).toBe("abc");

    state.setViewerScrollX(1);
    await settleUntil("by one", (frame) =>
      (code(frame)[0] ?? "").startsWith("1234")
    );
    expect(code(captureCharFrame()).slice(1)).toEqual([
      "bc",
      " if tabbed",
      " 字漢字 wide",
    ]);

    state.setViewerScrollX(8);
    await settleUntil("by eight", (frame) =>
      (code(frame)[0] ?? "").startsWith("89-")
    );
    expect(code(captureCharFrame()).slice(1)).toEqual(["", "bed", " wide"]);
  } finally {
    renderer.destroy();
  }
}, 20_000);

// Terminals that forward shift+wheel as a vertical report get a sideways scroll; one that already
// Turned it sideways (macOS) reports left/right, which scrolls sideways as it came.
test("shift turns the wheel sideways", async () => {
  const repoRoot = createFixtureRepo("stet-scroll-shift-", {
    "a.ts": `0123456789${"-".repeat(200)}\nabc\n`,
  });

  seedState(await loadModel(repoRoot, scope), scope);

  const { captureCharFrame, mockMouse, renderOnce, renderer } =
    await testRender(() => <App />, { height: 16, width: 80 });

  const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

  try {
    await settleUntil("loaded", (frame) => frame.includes("0123456789"));

    const { x, y } = state.layout().viewer.content;
    await mockMouse.scroll(x + 10, y + 2, "down", {
      modifiers: { shift: true },
    });
    await renderOnce();
    expect(state.viewerScrollX()).toBeGreaterThan(0);
    expect(state.viewerScrollTop()).toBe(0);

    await mockMouse.scroll(x + 10, y + 2, "up", { modifiers: { shift: true } });
    await mockMouse.scroll(x + 10, y + 2, "right", {
      modifiers: { shift: true },
    });
    await renderOnce();
    expect(state.viewerScrollX()).toBeGreaterThan(0);
  } finally {
    renderer.destroy();
  }
}, 20_000);

test("with lines wrapped, shift and the wheel still scroll down the file", async () => {
  const repoRoot = createFixtureRepo("stet-scroll-shift-wrap-", {
    "a.ts": `${Array.from({ length: 60 }, (_, index) => `line ${index}`).join("\n")}\n`,
  });

  seedState(await loadModel(repoRoot, scope), scope);
  state.setOverflow("wrap");

  const { captureCharFrame, mockMouse, renderOnce, renderer } =
    await testRender(() => <App />, { height: 16, width: 80 });

  const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

  try {
    await settleUntil("loaded", (frame) => frame.includes("line 0"));

    const { x, y } = state.layout().viewer.content;
    await mockMouse.scroll(x + 10, y + 2, "down", {
      modifiers: { shift: true },
    });
    await renderOnce();
    expect(state.viewerScrollTop()).toBeGreaterThan(0);
  } finally {
    renderer.destroy();
  }
}, 20_000);
