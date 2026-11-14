import { expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { testRender } from "@opentui/solid";

import { App } from "@/app";

import {
  createFixtureRepo,
  loadModel,
  makeSettleUntil,
  seedState,
} from "./helpers";

test("a repo name wider than the header truncates and keeps the changed count", async () => {
  // `mkdtemp` appends six characters, so the repo folder is 76 cells: wider than the 78 an
  // 80-column header has once the scope and the changed count are placed.
  const repoRoot = createFixtureRepo(`stet-${"long-repo-name-".repeat(4)}x-`, {
    "src/a.ts": "const a = 1\n",
  });
  writeFileSync(path.join(repoRoot, "src/a.ts"), "const a = 2\n");

  const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
  seedState(model, { kind: "all", ref: "HEAD" });
  const { renderer, renderOnce, captureCharFrame } = await testRender(
    () => <App />,
    { height: 24, width: 80 }
  );
  const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

  try {
    const frame = await settleUntil("app chrome", (text) =>
      text.includes("q quit")
    );
    const [header = ""] = frame.split("\n");
    expect(header).toContain("1 changed");
    expect(header).toContain("stet-long-repo-name-");
    expect(header).toContain("…");
  } finally {
    renderer.destroy();
    rmSync(repoRoot, { force: true, recursive: true });
  }
}, 20_000);
