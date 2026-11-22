import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { ScrollBoxRenderable } from "@opentui/core";
import type { Renderable } from "@opentui/core";
import { testRender } from "@opentui/solid";

import { App } from "@/app";
import { state } from "@/state";

import {
  createFixtureRepo,
  loadModel,
  makeSettleUntil,
  seedState,
} from "./helpers";

/**
 * Toggling a diff to whole-file view used to leave the viewport blank until the user scrolled: the
 * cursor jumps deep into the now-taller content, but the scrollbox clamped the physical scroll to its
 * content height as last laid out, stranding the viewport in the empty top spacer. The viewer now
 * re-applies `scrollTo` whenever scrollTop changes, and OpenTUI applies it again after the next
 * frame's layout, so the deep scroll lands against the new content.
 */
const visibleLineNumbers = (frame: string) =>
  (frame.match(/line_\d+ =/gu) ?? []).map((match) =>
    Number(match.replaceAll(/\D/gu, ""))
  );

/**
 * The diff viewer's scrollbox is the deepest-scrolling box in the tree (the file tree is short);
 * find it so the test can read physical scroll metrics.
 */
const diffScrollBox = (node: Renderable) => {
  const candidates: ScrollBoxRenderable[] = [];

  const walk = (current: Renderable) => {
    if (current instanceof ScrollBoxRenderable) {
      candidates.push(current);
    }

    for (const child of current.getChildren()) {
      walk(child);
    }
  };

  walk(node);

  return candidates.toSorted((a, b) => b.scrollHeight - a.scrollHeight)[0];
};

const longFileToggleFixture = (prefix: string) => {
  const lines = Array.from(
    { length: 120 },
    (_, index) => `const line_${index + 1} = ${index + 1}`
  );

  const repoRoot = createFixtureRepo(prefix, {
    "long.ts": `${lines.join("\n")}\n`,
    "package.json": `${JSON.stringify({ scripts: { lint: "exit 0", typecheck: "exit 0" } })}\n`,
  });

  // Edit a single line near the bottom: the diff is a small hunk low in the file, so
  // The whole-file view is far taller than the diff content it replaces.
  writeFileSync(
    path.join(repoRoot, "long.ts"),
    `${lines.with(109, "const line_110 = 9999").join("\n")}\n`
  );

  return repoRoot;
};

describe("view toggle scroll", () => {
  test("toggling to file view shows a low change immediately, no navigation", async () => {
    const repoRoot = longFileToggleFixture("stet-toggle-scroll-");
    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });

    const { renderer, renderOnce, captureCharFrame, mockInput } =
      await testRender(() => <App />, {
        height: 34,
        width: 120,
      });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      // The diff lands with the cursor on the low change.
      await settleUntil(
        "diff view",
        (frame) =>
          /[+-]\d+\s*$/u.test(
            frame.split("\n")[state.layout().viewer.y] ?? ""
          ) && state.cursorLineNumber() === 110,
        5
      );

      // Focus the viewer and toggle to whole-file view.
      mockInput.pressTab();
      mockInput.pressKey("v");

      // The cursor stays on line 110, now deep in the full file. Without the fix the
      // Viewport stays blank here (the settle would time out); with it, the content
      // Around line 110 paints with no intervening navigation.
      const frame = await settleUntil(
        "low change visible in file view",
        (current) => {
          if (!/\d+ lines/u.test(current) || state.cursorLineNumber() !== 110) {
            return false;
          }

          const numbers = visibleLineNumbers(current);

          return numbers.includes(110) && numbers.length > 20;
        }
      );

      expect(visibleLineNumbers(frame)).toContain(110);

      const box = diffScrollBox(renderer.root);
      expect(box).toBeDefined();
      expect(box.scrollHeight).toBeGreaterThanOrEqual(115);
      expect(box.scrollTop).toBeGreaterThan(50);
    } finally {
      renderer.destroy();
    }
  }, 20_000);
});
