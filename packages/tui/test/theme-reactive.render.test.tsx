import { describe, expect, test } from "bun:test";

import { RGBA } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { render, testRender } from "@opentui/solid";

import { App } from "@/app";
import { appearance, setAppearance, setSelection } from "@/theme/active";
import { ansiFromSlots, paletteTheme } from "@/theme/palette";
import {
  registerSystemTheme,
  registerThemes,
  zedThemeForName,
} from "@/theme/registry";

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

  test("App takes the terminal's current mode when it mounts", async () => {
    const { renderer } = await createTestRenderer({ height: 24, width: 80 });

    // The test renderer cannot receive a terminal mode report (its input parser rejects the
    // sequence), so this stands in for a terminal that flipped to light before App subscribed.
    Object.defineProperty(renderer, "themeMode", { get: () => "light" });

    try {
      await render(() => <App />, renderer);

      expect(appearance()).toBe("light");
    } finally {
      renderer.destroy();
    }
  });

  test("App re-reads the palette of the terminal's system theme when it mounts", async () => {
    registerSystemTheme(
      paletteTheme("system", "dark", {
        ansi: ansiFromSlots([]),
        background: DARK_BG,
        foreground: "#eeeeee",
      })
    );

    const { renderer } = await createTestRenderer({ height: 24, width: 80 });

    // The test renderer has no terminal to query, so this stands in for a terminal that flipped
    // to light during startup and now reports its light palette.
    renderer.getPalette = async () =>
      await Promise.resolve({
        cursorColor: null,
        defaultBackground: LIGHT_BG,
        defaultForeground: "#111111",
        highlightBackground: null,
        highlightForeground: null,
        mouseBackground: null,
        mouseForeground: null,
        palette: Array.from({ length: 16 }, () => "#777777"),
        tekBackground: null,
        tekForeground: null,
      });

    try {
      await render(() => <App />, renderer);
      await Bun.sleep(0);

      expect(zedThemeForName("system").style["editor.background"]).toBe(
        LIGHT_BG
      );
    } finally {
      renderer.destroy();
    }
  });
});
