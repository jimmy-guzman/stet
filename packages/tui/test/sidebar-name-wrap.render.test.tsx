import { describe, expect, test } from "bun:test";

import { testRender } from "@opentui/solid";

import { App } from "@/App";
import { emptyActivityLog, recordActivity } from "@/git/activity";
import { state } from "@/state";

import { createFixtureRepo, loadModel, makeSettleUntil, seedState } from "./helpers";

// A tree row's filename is a single-cell-tall leaf, so it must never wrap. OpenTUI's
// <text> defaults to wrapMode "word": a name whose rendered width exceeds its flex slot
// (the recency dot's two cells are not reserved in the width budget) wraps onto a second
// Visual line. A wheel event is hit-tested to that text renderable and dispatched to it
// Before it bubbles to the list, so it scrolls the multi-line buffer; because the windowed
// Rows reuse native renderables, the offset sticks and the row then paints a mid or tail
// Fragment of the name instead of its start (only destroying the renderables, by closing and
// Reopening the sidebar, clears it). Pinning wrapMode "none" keeps the name one line, so the
// Wheel has nowhere to scroll it.
describe("sidebar filename does not scroll on wheel", () => {
  test("keeps the tree row showing the name start after a wheel over it", async () => {
    const longName = "a-really-quite-long-repository-file-name.txt";
    const repoRoot = createFixtureRepo("stet-name-wrap-", {
      [longName]: "one\n",
      "short.txt": "two\n",
    });
    const scope = { kind: "all", ref: "HEAD" } as const;
    const model = await loadModel(repoRoot, scope);
    seedState(model, scope);

    const { renderer, mockMouse, renderOnce, captureCharFrame } = await testRender(() => <App />, {
      height: 20,
      width: 100,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    // The file is recent (a dot renders beside its name) but not a working-tree change, so no
    // Diff or diagnostic badge reserves the extra width the name overruns its slot by.
    state.setActivityLog(
      recordActivity(emptyActivityLog, [{ kind: "changed", path: longName }], Date.now()),
    );

    // Isolate the sidebar column (left of the pane divider). The header and the status bar's
    // Recent-file cue also print the name, so assert on the single tree-row line, never the
    // Whole frame, or those confound the check.
    const sidebarLines = (frame: string) => frame.split("\n").map((line) => line.split("││")[0]);
    const namePrefix = longName.slice(0, 16);

    const before = sidebarLines(
      await settleUntil("name renders in the tree", (frame) =>
        sidebarLines(frame).some((line) => line.includes(namePrefix)),
      ),
    );
    const rowY = before.findIndex((line) => line.includes(namePrefix));
    expect(rowY).toBeGreaterThanOrEqual(0);
    expect(before[rowY]).toContain(namePrefix);

    // Scroll the wheel with the pointer over the name cells of that row.
    for (let i = 0; i < 3; i += 1) {
      // oxlint-disable-next-line no-await-in-loop -- sequential wheel notches
      await mockMouse.scroll(10, rowY, "down");
      // oxlint-disable-next-line no-await-in-loop -- settle between notches
      await renderOnce();
    }
    await renderOnce();

    // The name is one line, so the wheel cannot shift it: the row still shows the name start.
    expect(sidebarLines(captureCharFrame())[rowY]).toContain(namePrefix);

    renderer.destroy();
  }, 20_000);
});
