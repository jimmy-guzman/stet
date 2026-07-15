import { describe, expect, test } from "bun:test";

import { builtinIcons } from "@/file-support/builtins";
import { darkTheme } from "@/theme/dark";
import { lightTheme } from "@/theme/light";
import {
  registerThemes,
  resolveThemes,
  restoreRegistry,
  selectThemeName,
  snapshotRegistry,
  themeForName,
  themeNames,
} from "@/theme/registry";

describe("themeForName", () => {
  test("returns a built-in by name", () => {
    expect(themeForName("dark")).toBe(darkTheme);
  });

  test("falls back to dark for an unknown name", () => {
    expect(themeForName("does-not-exist")).toBe(darkTheme);
  });
});

describe("built-in icon colors", () => {
  test("uses the curated file icon palette", () => {
    const coloredIcons = [
      "astro",
      "bun",
      "codeowners",
      "css",
      "csv",
      "database",
      "docker",
      "git",
      "go",
      "gradle",
      "groovy",
      "heroku",
      "html",
      "http",
      "image",
      "java",
      "javascript",
      "json",
      "kotlin",
      "license",
      "make",
      "markdown",
      "maven",
      "node",
      "pdf",
      "profile",
      "python",
      "react",
      "readme",
      "ruby",
      "rust",
      "scala",
      "shell",
      "spreadsheet",
      "storybook",
      "test",
      "toml",
      "tsconfig",
      "typescript",
      "video",
      "yaml",
    ];

    expect(Object.keys(darkTheme.icon)).toEqual(coloredIcons);
    expect(Object.keys(lightTheme.icon)).toEqual(coloredIcons);
  });

  test("accounts for every built-in icon as colored or intentionally muted", () => {
    const mutedIcons = [
      "config",
      "document",
      "file",
      "folder",
      "folder-open",
      "lock",
      "symlink",
      "template",
    ];

    expect(
      [...builtinIcons.keys()].filter((icon) => darkTheme.icon[icon] === undefined).toSorted(),
    ).toEqual(mutedIcons);
    expect(
      [...builtinIcons.keys()].filter((icon) => lightTheme.icon[icon] === undefined).toSorted(),
    ).toEqual(mutedIcons);
    expect(Object.keys(darkTheme.icon).filter((icon) => !builtinIcons.has(icon))).toEqual([]);
    expect(Object.keys(lightTheme.icon).filter((icon) => !builtinIcons.has(icon))).toEqual([]);
  });

  test("keeps every icon color visible across its theme surfaces", () => {
    const channel = (hex: string, offset: number) => {
      const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    const luminance = (hex: string) =>
      0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
    const contrast = (foreground: string, background: string) => {
      const values = [luminance(foreground), luminance(background)].toSorted((a, b) => b - a);
      return (values[0] + 0.05) / (values[1] + 0.05);
    };
    const failures = Object.entries({ dark: darkTheme, light: lightTheme }).flatMap(
      ([appearance, theme]) =>
        Object.entries(theme.icon).flatMap(([icon, color]) =>
          Object.entries({
            base: theme.surface.base,
            cursor: theme.surface.cursor,
            panel: theme.surface.panel,
          })
            .map(([surface, background]) => ({
              appearance,
              contrast: contrast(color, background),
              icon,
              surface,
            }))
            .filter((result) => result.contrast < 3),
        ),
    );

    expect(failures).toEqual([]);
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

describe("themeNames", () => {
  test("includes the built-ins", () => {
    expect(themeNames()).toContain("dark");
    expect(themeNames()).toContain("light");
  });

  test("lists registered themes after the built-ins", () => {
    const snapshot = snapshotRegistry();
    try {
      registerThemes(resolveThemes({ "registry-probe": { base: "dark" } }).themes);
      const names = themeNames();

      expect(names).toContain("registry-probe");
      expect(names.indexOf("dark")).toBeLessThan(names.indexOf("registry-probe"));
    } finally {
      restoreRegistry(snapshot);
    }
  });
});

describe("resolveThemes", () => {
  test("accepts a full theme", () => {
    const { issues, themes } = resolveThemes({ mine: darkTheme });

    expect(issues).toEqual([]);
    expect(themes.get("mine")?.tokens).toEqual(darkTheme);
  });

  test("merges a base override, inheriting unspecified tokens", () => {
    const { issues, themes } = resolveThemes({
      soft: { accent: { primary: "#abcdef" }, base: "dark" },
    });

    expect(issues).toEqual([]);
    expect(themes.get("soft")?.tokens.accent.primary).toBe("#abcdef");
    expect(themes.get("soft")?.tokens.surface.base).toBe(darkTheme.surface.base);
  });

  test("merges dynamic icon colors over a base", () => {
    const { issues, themes } = resolveThemes({
      soft: { base: "dark", icon: { lua: "#abcdef", typescript: "#123456" } },
    });

    expect(issues).toEqual([]);
    expect(themes.get("soft")?.tokens.icon.lua).toBe("#abcdef");
    expect(themes.get("soft")?.tokens.icon.typescript).toBe("#123456");
    expect(themes.get("soft")?.tokens.icon.folder).toBeUndefined();
  });

  test("resolves a base that is another custom theme", () => {
    const { issues, themes } = resolveThemes({
      child: { base: "parent", surface: { base: "#0a0a0a", cursor: "#0b0b0b", panel: "#0c0c0c" } },
      parent: { accent: { primary: "#abcdef" }, base: "dark" },
    });

    expect(issues).toEqual([]);
    expect(themes.get("child")?.tokens.accent.primary).toBe("#abcdef");
    expect(themes.get("child")?.tokens.surface.base).toBe("#0a0a0a");
  });

  test("a string syntax names a bundled theme and inherits through a base", () => {
    const { issues, themes } = resolveThemes({
      child: { base: "parent" },
      parent: { base: "dark", syntax: "catppuccin-mocha" },
    });

    expect(issues).toEqual([]);
    expect(themes.get("parent")?.syntaxTheme).toBe("catppuccin-mocha");
    expect(themes.get("child")?.syntaxTheme).toBe("catppuccin-mocha");
  });

  test("an object syntax overrides token colors (no bundled theme)", () => {
    const { issues, themes } = resolveThemes({
      mine: { base: "dark", syntax: { keyword: "#abcdef" } },
    });

    expect(issues).toEqual([]);
    expect(themes.get("mine")?.syntaxTheme).toBeUndefined();
    expect(themes.get("mine")?.tokens.syntax.keyword).toBe("#abcdef");
    expect(themes.get("mine")?.tokens.syntax.string).toBe(darkTheme.syntax.string);
  });

  test("reports an unknown bundled syntax theme but still resolves the tokens", () => {
    const { issues, themes } = resolveThemes({ mine: { base: "dark", syntax: "nope" } });

    expect(themes.get("mine")?.syntaxTheme).toBeUndefined();
    expect(themes.get("mine")?.tokens).toBeDefined();
    expect(issues.some((issue) => issue.includes("syntax theme"))).toBe(true);
  });

  test("reports an unknown base and skips the theme", () => {
    const { issues, themes } = resolveThemes({ mine: { base: "nope" } });

    expect(themes.has("mine")).toBe(false);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("nope");
  });

  test("an invalid shared base is reported once, not per referrer", () => {
    const { issues, themes } = resolveThemes({
      a: { base: "bad" },
      b: { base: "bad" },
      bad: { accent: { primary: "oops" } },
    });

    expect(themes.size).toBe(0);
    expect(issues.filter((issue) => issue.startsWith('theme "bad":'))).toHaveLength(1);
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
