import { expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { testRender } from "@opentui/solid";

import { App } from "../src/App";
import { createFixtureRepo, loadModel, makeSettleUntil, seedState } from "./helpers";

const allScope = { kind: "all", ref: "HEAD" } as const;

// End-to-end live refresh: the filesystem watcher, not a render tick, is what
// Drives this. The fixture starts clean (no churn badge); editing the file on
// Disk must make the tree show its churn without any keypress or poll wait.
test("the tree reflects an on-disk edit via the watcher", async () => {
  const repo = createFixtureRepo("watcher-render-", { "watched.txt": "one\n" });
  try {
    seedState(await loadModel(repo, allScope), allScope);
    const { renderer, renderOnce, captureCharFrame } = await testRender(() => <App />, {
      height: 24,
      width: 100,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    const before = await settleUntil("clean tree", (frame) => frame.includes("watched.txt"));
    expect(before).not.toContain("+1 -0");

    writeFileSync(join(repo, "watched.txt"), "one\ntwo\n");

    const after = await settleUntil("churn badge after edit", (frame) => frame.includes("+1 -0"));
    expect(after).toContain("watched.txt");

    renderer.destroy();
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});
