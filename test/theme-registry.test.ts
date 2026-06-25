import { describe, expect, test } from "bun:test";

import { darkTheme } from "../src/theme/dark";
import { resolveThemes, selectThemeName, themeForName } from "../src/theme/registry";

describe("themeForName", () => {
  test("returns a built-in by name", () => {
    expect(themeForName("dark")).toBe(darkTheme);
  });

  test("falls back to dark for an unknown name", () => {
    expect(themeForName("does-not-exist")).toBe(darkTheme);
  });
});

describe("selectThemeName", () => {
  test("uses the appearance when nothing is selected", () => {
    expect(selectThemeName(undefined, "light")).toBe("light");
  });

  test("a single name pins regardless of appearance", () => {
    expect(selectThemeName("gruvbox", "light")).toBe("gruvbox");
  });

  test("a pair follows the appearance", () => {
    expect(selectThemeName({ dark: "a", light: "b" }, "dark")).toBe("a");
    expect(selectThemeName({ dark: "a", light: "b" }, "light")).toBe("b");
  });
});

describe("resolveThemes", () => {
  test("accepts a full theme", () => {
    const { issues, themes } = resolveThemes({ mine: darkTheme });

    expect(issues).toEqual([]);
    expect(themes.get("mine")).toEqual(darkTheme);
  });

  test("merges a base override, inheriting unspecified tokens", () => {
    const { issues, themes } = resolveThemes({
      soft: { accent: { primary: "#abcdef" }, base: "dark" },
    });

    expect(issues).toEqual([]);
    expect(themes.get("soft")?.accent.primary).toBe("#abcdef");
    expect(themes.get("soft")?.surface.base).toBe(darkTheme.surface.base);
  });

  test("resolves a base that is another custom theme", () => {
    const { issues, themes } = resolveThemes({
      child: { base: "parent", surface: { base: "#0a0a0a", cursor: "#0b0b0b", panel: "#0c0c0c" } },
      parent: { accent: { primary: "#abcdef" }, base: "dark" },
    });

    expect(issues).toEqual([]);
    expect(themes.get("child")?.accent.primary).toBe("#abcdef");
    expect(themes.get("child")?.surface.base).toBe("#0a0a0a");
  });

  test("reports an unknown base and skips the theme", () => {
    const { issues, themes } = resolveThemes({ mine: { base: "nope" } });

    expect(themes.has("mine")).toBe(false);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("nope");
  });

  test("reports a circular base", () => {
    const { issues, themes } = resolveThemes({ a: { base: "b" }, b: { base: "a" } });

    expect(themes.size).toBe(0);
    expect(issues.some((issue) => issue.includes("circular"))).toBe(true);
  });

  test("reports an invalid override value", () => {
    const { issues, themes } = resolveThemes({
      mine: { accent: { primary: "red" }, base: "dark" },
    });

    expect(themes.has("mine")).toBe(false);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("accent");
  });

  test("reports an invalid full theme", () => {
    const { issues, themes } = resolveThemes({ mine: { accent: { primary: "#abcdef" } } });

    expect(themes.has("mine")).toBe(false);
    expect(issues).toHaveLength(1);
  });
});
