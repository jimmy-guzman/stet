import { describe, expect, test } from "bun:test";

import { RGBA } from "@opentui/core";
import { Predicate } from "effect";

import { deriveTheme } from "@/theme/derive";
import { ansiFromSlots, paletteTheme } from "@/theme/palette";
import { loadBundledThemes, themeForName, themeNames } from "@/theme/registry";
import { resolveTheme } from "@/theme/resolve";
import type { Theme } from "@/theme/tokens";
import { normalizeTheme, opaqueHex } from "@/theme/zed";

const HEX = /^#[0-9a-f]{6}$/u;

/** Every theme leaf is a color, at most two levels deep (`success`, `text.primary`). */
const colorEntries = (theme: Theme) =>
  Object.entries(theme).flatMap(
    ([group, value]: [string, Theme[keyof Theme]]) =>
      Predicate.isString(value)
        ? [{ color: value, path: group }]
        : Object.entries(value).map(([key, color]) => ({
            color,
            path: `${group}.${key}`,
          }))
  );

const paths = (theme: Theme) =>
  colorEntries(theme)
    .map(({ path }) => path)
    .toSorted((a, b) => a.localeCompare(b));

const stetDark = themeForName("stet-dark");
const stetLight = themeForName("stet-light");

describe("deriveTheme", () => {
  test("every built-in and bundled theme derives to lowercase 6-digit hex", async () => {
    await loadBundledThemes();

    const failures = themeNames().flatMap((name) =>
      colorEntries(themeForName(name))
        .filter(({ color }) => !HEX.test(color))
        .map(({ color, path }) => `${name} ${path} ${color}`)
    );

    expect(themeNames().length).toBeGreaterThan(80);
    expect(failures).toEqual([]);
  });

  test("every theme exposes the same token paths", async () => {
    await loadBundledThemes();

    const expected = paths(stetDark);

    expect(
      themeNames().filter(
        (name) => paths(themeForName(name)).join(",") !== expected.join(",")
      )
    ).toEqual([]);
  });

  test("change kinds stand apart from the background in every theme", async () => {
    await loadBundledThemes();

    expect(
      themeNames().filter((name) => {
        const theme = themeForName(name);

        return Object.values(theme.kind).includes(theme.surface.base);
      })
    ).toEqual([]);
  });

  test("the accent is the theme's text.accent, else its magenta", () => {
    const palette = {
      ansi: ansiFromSlots([
        "#000000",
        "#ff0000",
        "#00ff00",
        "#ffff00",
        "#0000ff",
        "#ff00ff",
        "#00ffff",
        "#c0c0c0",
      ]),
      background: "#101010",
      foreground: "#f0f0f0",
    };

    expect(deriveTheme(paletteTheme("a", "dark", palette)).accent.primary).toBe(
      "#ff00ff"
    );
    expect(
      deriveTheme(paletteTheme("b", "dark", { ...palette, accent: "#123456" }))
        .accent.primary
    ).toBe("#123456");
  });

  test("text tiers step from the background toward the foreground", () => {
    for (const theme of [stetDark, stetLight]) {
      const { base } = theme.surface;
      const { faint, muted, primary, secondary, strong } = theme.text;

      const distance = (hex: string) =>
        Math.abs(
          Number.parseInt(hex.slice(1, 3), 16) -
            Number.parseInt(base.slice(1, 3), 16)
        );

      expect(distance(faint)).toBeLessThan(distance(muted));
      expect(distance(muted)).toBeLessThan(distance(secondary));
      expect(distance(secondary)).toBeLessThan(distance(strong));
      expect(distance(strong)).toBeLessThanOrEqual(distance(primary));
    }
  });
});

describe("normalizeTheme", () => {
  test("composites translucent colors over the background", () => {
    expect(opaqueHex("#ffffff80", "#000000")).toBe("#808080");
    expect(opaqueHex("#ABCDEF", "#000000")).toBe("#abcdef");
  });

  test("rejects a malformed or overflowing Display P3 channel", () => {
    expect(opaqueHex("color(display-p3 0..5 0 0)", "#000000")).toBeUndefined();
    expect(
      opaqueHex(`color(display-p3 0 0 ${"9".repeat(400)})`, "#000000")
    ).toBeUndefined();
    expect(opaqueHex("color(display-p3 .5 1 0.25 / 50%)", "#000000")).toMatch(
      HEX
    );
  });

  test("converts Display P3 colors to sRGB hex", () => {
    expect(opaqueHex("color(display-p3 1 1 1)", "#000000")).toBe("#ffffff");
    expect(opaqueHex("color(display-p3 0 0 0)", "#000000")).toBe("#000000");
    expect(opaqueHex("color(display-p3 1 0 0)", "#000000")).toMatch(HEX);
  });

  test("parses every CSS color form and P3 with alpha", () => {
    expect(opaqueHex("rgb(1, 2, 3)", "#000000")).toBe("#010203");
    expect(opaqueHex("red", "#000000")).toBe("#ff0000");
    expect(opaqueHex("color(display-p3 1 1 1 / 0.5)", "#000000")).toBe(
      "#808080"
    );
    expect(opaqueHex("color(display-p3 1 1 1 / 50%)", "#000000")).toBe(
      "#808080"
    );
    expect(opaqueHex("not a color", "#000000")).toBeUndefined();
  });

  test("keeps only what parses as a color, so derivation never sees anything else", () => {
    const theme = normalizeTheme({
      appearance: "dark",
      name: "odd",
      style: {
        "editor.background": "#000000",
        "editor.foreground": "rgb(255, 255, 255)",
        "terminal.ansi.red": "var(--red)",
      },
    });

    expect(theme.style["editor.foreground"]).toBe("#ffffff");
    expect(theme.style["terminal.ansi.red"]).toBeUndefined();
    expect(
      colorEntries(deriveTheme(theme)).filter(({ color }) => !HEX.test(color))
    ).toEqual([]);
  });

  test("normalizes syntax to opaque colors, one per scope", () => {
    const theme = normalizeTheme({
      appearance: "dark",
      name: "p3",
      style: {
        background: "#000000",
        syntax: {
          comment: { color: "color(display-p3 1 1 1)", font_style: "italic" },
          keyword: "#FF000080",
        },
      },
    });

    expect(theme.style.syntax).toEqual({
      comment: "#ffffff",
      keyword: "#800000",
    });
  });
});

const activeVariants = (theme: Theme) => {
  const resolved = resolveTheme(theme);

  return [
    [resolved.rgba.addedBgActive, theme.diff.addedBg],
    [resolved.rgba.removedBgActive, theme.diff.removedBg],
    [resolved.rgba.findMatchBgActive, theme.find.matchBg],
  ] as const;
};

describe("resolveTheme", () => {
  test("transparent is the zero RGBA singleton", () => {
    const resolved = resolveTheme(stetDark);

    expect(resolved.colors).toBe(stetDark);
    expect(resolved.rgba.transparent).toEqual(RGBA.fromValues(0, 0, 0, 0));
  });

  test("dark active variants brighten their base token and stay clamped", () => {
    for (const [active, baseHex] of activeVariants(stetDark)) {
      const base = RGBA.fromHex(baseHex);

      // No channel darkens or overflows...
      for (const channel of ["r", "g", "b"] as const) {
        expect(active[channel]).toBeGreaterThanOrEqual(base[channel]);
        expect(active[channel]).toBeLessThanOrEqual(1);
      }

      // ...and the variant is genuinely brighter than its base, not a no-op.
      expect(active.r + active.g + active.b).toBeGreaterThan(
        base.r + base.g + base.b
      );
    }
  });

  test("light active variants darken their base token instead of washing to white", () => {
    for (const [active, baseHex] of activeVariants(stetLight)) {
      const base = RGBA.fromHex(baseHex);

      // No channel brightens or underflows...
      for (const channel of ["r", "g", "b"] as const) {
        expect(active[channel]).toBeLessThanOrEqual(base[channel]);
        expect(active[channel]).toBeGreaterThanOrEqual(0);
      }

      // ...and the variant is genuinely darker than its base, never clamped to white.
      expect(active.r + active.g + active.b).toBeLessThan(
        base.r + base.g + base.b
      );
    }
  });
});

const distance = (a: RGBA, b: RGBA) =>
  Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);

describe.each(["stet-dark", "stet-light", "mono-dark", "mono-light"])(
  "%s changed-word backgrounds",
  (name) => {
    test("lean toward the line's sign color over both the normal and the lifted row", () => {
      const theme = themeForName(name);
      const { rgba } = resolveTheme(theme);

      const cases = [
        [
          rgba.addedWordBg,
          RGBA.fromHex(theme.diff.addedBg),
          theme.diff.addedSign,
        ],
        [rgba.addedWordBgActive, rgba.addedBgActive, theme.diff.addedSign],
        [
          rgba.removedWordBg,
          RGBA.fromHex(theme.diff.removedBg),
          theme.diff.removedSign,
        ],
        [
          rgba.removedWordBgActive,
          rgba.removedBgActive,
          theme.diff.removedSign,
        ],
      ] as const;

      for (const [word, row, signHex] of cases) {
        const sign = RGBA.fromHex(signHex);

        expect(word).not.toEqual(row);
        expect(distance(word, sign)).toBeLessThan(distance(row, sign));
      }
    });
  }
);

describe("paletteTheme", () => {
  test("puts each given syntax role into the highlighter theme", () => {
    const roles = [
      "comment",
      "function",
      "keyword",
      "keywordControl",
      "keywordImport",
      "member",
      "number",
      "operator",
      "punctuation",
      "string",
      "tag",
      "type",
    ];

    // A distinct sentinel per role, so an unmapped role cannot hide behind another that shares
    // Its color.
    const syntax = Object.fromEntries(
      roles.map((role, index) => [
        role,
        `#0000${index.toString(16).padStart(2, "0")}`,
      ])
    );

    const theme = paletteTheme("sentinel", "dark", {
      ansi: ansiFromSlots([]),
      background: "#000000",
      foreground: "#ffffff",
      syntax,
    });

    const mapped = new Set(Object.values(theme.style.syntax ?? {}));

    expect(Object.values(syntax).filter((color) => !mapped.has(color))).toEqual(
      []
    );
  });
});
