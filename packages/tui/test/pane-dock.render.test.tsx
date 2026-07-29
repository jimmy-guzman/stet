import { expect, test } from "bun:test";

import { testRender } from "@opentui/solid";

import { App } from "@/App";
import { state } from "@/state";

import { createFixtureRepo, loadModel, makeSettleUntil, seedState } from "./helpers";

// Slice the frame by the pane's rect, not by the `││` seam the other render tests use:
// That seam is an artifact of the sidebar meeting the viewer on the left, so it locates
// Nothing once a pane can dock anywhere. Reading the rect back from `state.layout()`, the
// One owner of geometry, is also what makes the assertion "the tree painted inside its
// Own band" rather than "the tree is at column 0", which is the re-derivation the layout
// Model exists to keep out of the app. Slicing by code unit rather than by cell is fine
// Here because every assertion is containment within a band, never an exact column.
const paneLines = (frame: string, rect: { height: number; width: number; x: number; y: number }) =>
  frame
    .split("\n")
    .slice(rect.y, rect.y + rect.height)
    .map((line) => line.slice(rect.x, rect.x + rect.width));

test("the move key docks the tree to the right, and it renders there", async () => {
  const repoRoot = createFixtureRepo("stet-pane-dock-", { "src/a.ts": "export const a = 1;\n" });
  const scope = { kind: "all", ref: "HEAD" } as const;
  seedState(await loadModel(repoRoot, scope), scope);

  const { renderer, mockInput, renderOnce, captureCharFrame } = await testRender(() => <App />, {
    height: 24,
    width: 100,
  });
  try {
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });
    await settleUntil("first render", (current) => current.includes("a.ts"));
    expect(state.layout().sidebar.x).toBe(0);

    mockInput.pressKey("d"); // Left -> top
    mockInput.pressKey("d"); // Top -> right
    const frame = await settleUntil("docked right", () => state.sidebarPosition() === "right");

    // The viewer now starts at column 0 and the tree sits entirely to its right.
    const { sidebar, viewer } = state.layout();
    expect(viewer.x).toBe(0);
    expect(sidebar.x).toBe(viewer.x + viewer.width);

    // Each band holds its own content: the tree the entry, the viewer the file's text.
    expect(paneLines(frame, sidebar).join("\n")).toContain("a.ts");
    expect(paneLines(frame, viewer).join("\n")).toContain("export const a = 1");
    expect(paneLines(frame, sidebar).join("\n")).not.toContain("export const a = 1");
  } finally {
    renderer.destroy();
  }
});

test("a bare d never fires the move while the search pane owns the keys", async () => {
  const repoRoot = createFixtureRepo("stet-pane-dock-search-", {
    "src/a.ts": "export const a = 1;\n",
  });
  const scope = { kind: "all", ref: "HEAD" } as const;
  seedState(await loadModel(repoRoot, scope), scope);

  const { renderer, mockInput, renderOnce, captureCharFrame } = await testRender(() => <App />, {
    height: 24,
    width: 100,
  });
  try {
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });
    await settleUntil("first render", (current) => current.includes("a.ts"));

    mockInput.pressKey("f", { ctrl: true });
    await settleUntil("search open", () => state.mainView() === "search");
    mockInput.pressKey("d");
    await settleUntil("typed", () => true);

    expect(state.sidebarPosition()).toBe("left");
  } finally {
    renderer.destroy();
  }
});
