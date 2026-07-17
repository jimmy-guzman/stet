import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";

import { testRender } from "@opentui/solid";

import { App } from "@/App";
import { helpText } from "@/cli";
import { registerKeybindings, restoreKeybindings, snapshotKeybindings } from "@/keys/registry";
import { resolveKeybindings } from "@/keys/resolve";

import { createFixtureRepo, loadModel, makeSettleUntil, seedState } from "./helpers";

// End to end over the registry: a config rebind must move the live binding
// (the new combo fires, the default goes inert) and follow into the rendered
// Help, since `?` and `--help` read the same registry the keymap dispatches by.
describe("configured keybindings", () => {
  test("a rebound toggle fires on its new combo and the default goes inert", async () => {
    // Two files: a.ts gets auto-selected (so its name also shows in the viewer
    // Header), zz.md only ever renders in the tree, making it the sidebar sentinel.
    const repoRoot = createFixtureRepo("stet-keybind-", {
      "src/a.ts": "export const a = 1\n",
      "zz.md": "sentinel\n",
    });
    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });
    const baseline = snapshotKeybindings();
    const { issues, set } = resolveKeybindings({ "toggle-sidebar": "ctrl+e" });
    expect(issues).toEqual([]);
    registerKeybindings(set);

    const { renderer, renderOnce, captureCharFrame, mockInput } = await testRender(() => <App />, {
      height: 30,
      width: 90,
    });
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil("app chrome", (frame) => frame.includes("zz.md"), 5);

      // The default combo no longer toggles.
      mockInput.pressKey("b", { ctrl: true });
      const afterDefault = await settleUntil(
        "sidebar intact",
        (frame) => frame.includes("zz.md"),
        3,
      );
      expect(afterDefault).toContain("zz.md");

      // The configured combo does.
      mockInput.pressKey("e", { ctrl: true });
      await settleUntil("sidebar closed", (frame) => !frame.includes("zz.md"));

      mockInput.pressKey("e", { ctrl: true });
      await settleUntil("sidebar reopened", (frame) => frame.includes("zz.md"));

      // The rendered help reflects the rebind.
      expect(helpText()).toContain("ctrl+e");
      expect(helpText()).not.toContain("ctrl-b");
    } finally {
      restoreKeybindings(baseline);
      renderer.destroy();
      rmSync(repoRoot, { force: true, recursive: true });
    }
  }, 20_000);

  test("an unbound action drops out of the rendered help", () => {
    const baseline = snapshotKeybindings();
    try {
      registerKeybindings(resolveKeybindings({ provenance: false }).set);

      expect(helpText()).not.toContain("provenance rail");
    } finally {
      restoreKeybindings(baseline);
    }
  });
});
