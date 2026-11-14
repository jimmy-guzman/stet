import { describe, expect, test } from "bun:test";

import { RGBA } from "@opentui/core";
import { Predicate } from "effect";

import { darkTheme } from "@/theme/dark";
import { lightTheme } from "@/theme/light";
import { resolveTheme } from "@/theme/resolve";
import type { Theme } from "@/theme/tokens";

const HEX = /^#[0-9a-f]{6}$/u;

/** Every theme leaf is a color, at most two levels deep (`success`, `text.primary`). */
const colorEntries = (theme: Theme) =>
  Object.entries(theme).flatMap(([group, value]) =>
    Predicate.isString(value)
      ? [{ color: value, path: group }]
      : Object.entries(value).map(([key, color]) => ({
          color,
          path: `${group}.${key}`,
        }))
  );

describe.each([
  ["darkTheme", darkTheme],
  ["lightTheme", lightTheme],
])("%s", (_name, theme) => {
  test("every color token is a lowercase 6-digit hex", () => {
    const colors = colorEntries(theme);

    expect(colors.length).toBeGreaterThan(0);
    expect(colors.filter(({ color }) => !HEX.test(color))).toEqual([]);
  });
});

const paths = (theme: Theme) =>
  colorEntries(theme)
    .map(({ path }) => path)
    .toSorted();

describe("theme parity", () => {
  test("light and dark expose the exact same token paths", () => {
    expect(paths(lightTheme)).toEqual(paths(darkTheme));
  });
});

const activeVariants = (theme: typeof darkTheme) => {
  const resolved = resolveTheme(theme);

  return [
    [resolved.rgba.addedBgActive, theme.diff.addedBg],
    [resolved.rgba.removedBgActive, theme.diff.removedBg],
    [resolved.rgba.findMatchBgActive, theme.find.matchBg],
  ] as const;
};

describe("resolveTheme", () => {
  test("transparent is the zero RGBA singleton", () => {
    const resolved = resolveTheme(darkTheme);

    expect(resolved.colors).toBe(darkTheme);
    expect(resolved.rgba.transparent).toEqual(RGBA.fromValues(0, 0, 0, 0));
  });

  test("dark active variants brighten their base token and stay clamped", () => {
    for (const [active, baseHex] of activeVariants(darkTheme)) {
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
    for (const [active, baseHex] of activeVariants(lightTheme)) {
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
