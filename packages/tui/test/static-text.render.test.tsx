import { expect, test } from "bun:test";

import { testRender } from "@opentui/solid";

import { App } from "@/app";
import { state } from "@/state";

import {
  createFixtureRepo,
  loadModel,
  makeSettleUntil,
  runGit,
  seedState,
} from "./helpers";

// OpenTUI's text scrolls its own buffer under the wheel when its content overflows, on either axis.
test("a wheel over a clipped commit subject leaves it where it was", async () => {
  const repoRoot = createFixtureRepo("stet-static-text-", { "a.ts": "one\n" });
  const scope = { kind: "all", ref: "HEAD" } as const;

  runGit(repoRoot, [
    "commit",
    "--allow-empty",
    "-m",
    `feat: start ${"of a subject far wider than the overlay ".repeat(5)}`,
  ]);

  seedState(await loadModel(repoRoot, scope), scope);

  const { captureCharFrame, mockInput, mockMouse, renderOnce, renderer } =
    await testRender(() => <App />, { height: 30, width: 100 });

  const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

  try {
    await settleUntil("loaded", (frame) => frame.includes("q quit"));
    mockInput.pressKey("s");
    await settleUntil("scopes", (frame) => frame.includes("switch scope"));
    state.setScopeMenuView("commits");
    state.setScopeMenuIndex(0);
    state.loadCommits(repoRoot);

    const before = await settleUntil("commits", (frame) =>
      frame.includes("feat: start")
    );

    const rows = before.split("\n");
    const y = rows.findIndex((row) => row.includes("feat: start"));
    const x = (rows[y] ?? "").indexOf("feat: start") + 2;

    for (const direction of ["right", "right", "down"] as const) {
      // oxlint-disable-next-line no-await-in-loop -- one wheel tick per render pass
      await mockMouse.scroll(x, y, direction);
      // oxlint-disable-next-line no-await-in-loop -- one wheel tick per render pass
      await renderOnce();
    }

    expect(captureCharFrame().split("\n")[y]).toBe(rows[y]);
  } finally {
    renderer.destroy();
  }
}, 20_000);
