import { describe, expect, test } from "bun:test";

import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";

import { App } from "@/app";
import { setAppearance, setSelection } from "@/theme/active";
import { ansiFromSlots, paletteTheme } from "@/theme/palette";
import { registerThemes } from "@/theme/registry";

import {
  createFixtureRepo,
  loadModel,
  makeSettleUntil,
  seedState,
} from "./helpers";

// Two themes with unique, easy-to-spot surface backgrounds, one per appearance.
const DARK_BG = "#010203";
const LIGHT_BG = "#fdfdfd";

const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

const hasBackground = (
  frame: { lines: { spans: { bg: RGBA }[] }[] },
  hex: string
) => {
  const want = RGBA.fromHex(hex);

  return frame.lines.some((line) =>
    line.spans.some(
      (span) =>
        near(span.bg.r, want.r) &&
        near(span.bg.g, want.g) &&
        near(span.bg.b, want.b)
    )
  );
};

describe("runtime appearance follow (#101)", () => {
  test("flipping the terminal appearance re-themes the UI live", async () => {
    registerThemes(
      new Map([
        [
          "t-dark",
          paletteTheme("t-dark", "dark", {
            ansi: ansiFromSlots([]),
            background: DARK_BG,
            foreground: "#eeeeee",
          }),
        ],
        [
          "t-light",
          paletteTheme("t-light", "light", {
            ansi: ansiFromSlots([]),
            background: LIGHT_BG,
            foreground: "#111111",
          }),
        ],
      ])
    );
    setSelection({ dark: "t-dark", light: "t-light" });

    const repoRoot = createFixtureRepo("theme-reactive-", { "a.txt": "a\n" });
    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });

    const { renderer, renderOnce, captureCharFrame, captureSpans } =
      await testRender(() => <App />, {
        height: 32,
        width: 110,
      });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });
    await settleUntil("app chrome", (frame) => frame.includes("q quit"));

    expect(hasBackground(captureSpans(), DARK_BG)).toBe(true);
    expect(hasBackground(captureSpans(), LIGHT_BG)).toBe(false);

    // The renderer's theme_mode event would call this; drive it directly.
    setAppearance("light");
    await renderOnce();

    expect(hasBackground(captureSpans(), LIGHT_BG)).toBe(true);
    expect(hasBackground(captureSpans(), DARK_BG)).toBe(false);

    renderer.destroy();
  });
});
