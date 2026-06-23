import { describe, expect, test } from "bun:test";

import { RGBA } from "@opentui/core";

import { darkTheme } from "../src/theme/dark";
import { lightTheme } from "../src/theme/light";
import { resolveTheme } from "../src/theme/resolve";

const HEX = /^#[0-9a-f]{6}$/;

// Walks the theme and collects every string leaf; syntax style objects mix
// Booleans (bold/italic/…) with color strings, and only the strings matter here
function collectColors(value: unknown, path: string, out: [path: string, color: string][]) {
  if (typeof value === "string") {
    out.push([path, value]);
    return;
  }

  if (typeof value === "object" && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      collectColors(child, `${path}.${key}`, out);
    }
  }
}

describe.each([
  ["darkTheme", darkTheme],
  ["lightTheme", lightTheme],
])("%s", (_name, theme) => {
  test("every color token is a lowercase 6-digit hex", () => {
    const colors: [path: string, color: string][] = [];
    collectColors(theme, "theme", colors);

    expect(colors.length).toBeGreaterThan(0);
    expect(colors.filter(([, color]) => !HEX.test(color))).toEqual([]);
  });
});

describe("theme parity", () => {
  test("light and dark expose the exact same token paths", () => {
    const paths = (theme: unknown) => {
      const out: [path: string, color: string][] = [];
      collectColors(theme, "theme", out);
      return out.map(([path]) => path).toSorted();
    };

    expect(paths(lightTheme)).toEqual(paths(darkTheme));
  });
});

describe("resolveTheme", () => {
  test("precomputed RGBA values derive from their hex tokens", () => {
    const resolved = resolveTheme(darkTheme);

    expect(resolved.colors).toBe(darkTheme);
    expect(resolved.rgba.addedBg).toEqual(RGBA.fromHex(darkTheme.diff.addedBg));
    expect(resolved.rgba.cursorBg).toEqual(RGBA.fromHex(darkTheme.surface.cursor));
    expect(resolved.rgba.errorGutterBg).toEqual(RGBA.fromHex(darkTheme.severity.errorGutterBg));
    expect(resolved.rgba.findMatchBg).toEqual(RGBA.fromHex(darkTheme.find.matchBg));
    expect(resolved.rgba.removedBg).toEqual(RGBA.fromHex(darkTheme.diff.removedBg));
    expect(resolved.rgba.transparent).toEqual(RGBA.fromValues(0, 0, 0, 0));
    expect(resolved.rgba.warningGutterBg).toEqual(RGBA.fromHex(darkTheme.severity.warningGutterBg));
  });
});
