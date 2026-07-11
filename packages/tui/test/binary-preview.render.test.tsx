import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { testRender } from "@opentui/solid";

import { App } from "@/App";
import { state } from "@/state";

import { createFixtureRepo, loadModel, makeSettleUntil, runGit, seedState } from "./helpers";

function png(width: number, height: number, pad = 0): Uint8Array {
  const u32be = (n: number) => [(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
  return Uint8Array.from([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0,
    0,
    0,
    13,
    0x49,
    0x48,
    0x44,
    0x52,
    ...u32be(width),
    ...u32be(height),
    ...Array.from({ length: pad }, () => 0),
  ]);
}

describe("binary preview", () => {
  test("a changed image renders its metadata instead of a blank diff pane", async () => {
    const repoRoot = createFixtureRepo("binary-preview-", { "keep.ts": "keep\n" });
    writeFileSync(join(repoRoot, "logo.png"), png(128, 64));
    runGit(repoRoot, ["add", "logo.png"]);
    runGit(repoRoot, ["commit", "-m", "add logo"]);
    writeFileSync(join(repoRoot, "logo.png"), png(256, 128, 200));

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    state.selectFile("logo.png");

    const { renderer, renderOnce, captureCharFrame } = await testRender(() => <App />, {
      height: 32,
      width: 110,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      const frame = await settleUntil("binary preview", (current) =>
        current.includes("open externally"),
      );

      expect(frame).toContain("PNG image");
      // Both sides' dimensions, as an old -> new delta (the diff stet cannot draw).
      expect(frame).toContain("128x64");
      expect(frame).toContain("256x128");
    } finally {
      renderer.destroy();
    }
  });

  test("browsing an unchanged image shows its type, dimensions, and size", async () => {
    const repoRoot = createFixtureRepo("binary-browse-", { "keep.ts": "keep\n" });
    writeFileSync(join(repoRoot, "logo.png"), png(64, 32));
    runGit(repoRoot, ["add", "logo.png"]);
    runGit(repoRoot, ["commit", "-m", "add logo"]);

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    // Unchanged, so it opens in full-content mode: the single side drives the card.
    state.selectFile("logo.png");

    const { renderer, renderOnce, captureCharFrame } = await testRender(() => <App />, {
      height: 32,
      width: 110,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      const frame = await settleUntil("binary browse", (current) =>
        current.includes("open externally"),
      );

      expect(frame).toContain("PNG image");
      expect(frame).toContain("64x32");
      expect(frame).toContain("24 B");
    } finally {
      renderer.destroy();
    }
  });
});
