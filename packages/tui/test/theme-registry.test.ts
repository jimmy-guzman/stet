import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { themes } from "@pierre/highlights/themes/loader";

import { builtinIcons } from "@/file-support/builtins";
import { state } from "@/state";
import {
  activeTheme,
  activeThemeName,
  selection,
  setAppearance,
  setSelection,
} from "@/theme/active";
import { builtinThemes } from "@/theme/builtins";
import {
  canonicalThemeName,
  hasTheme,
  loadBundledThemes,
  loadTheme,
  registerSystemTheme,
  registerThemes,
  selectThemeName,
  themeForName,
  themeNames,
  zedThemeForName,
} from "@/theme/registry";
import { refreshTerminalPalette, systemTheme } from "@/theme/system";
import { isMonochromeTheme } from "@/theme/tokens";
import type { Theme } from "@/theme/tokens";
import { parseThemeFile, readUserThemes } from "@/theme/user";

const stetDark = themeForName("stet-dark");
const stetLight = themeForName("stet-light");

/** A one-theme Zed family, the shape of a file in the themes directory. */
const themeFile = (name: string, background: string) =>
  JSON.stringify({
    themes: [
      {
        appearance: "dark",
        name,
        style: {
          "editor.background": background,
          "editor.foreground": "#eeeeee",
          "terminal.ansi.green": "#00aa00",
          syntax: { keyword: { color: "#ff8800", font_style: "italic" } },
        },
      },
    ],
  });

describe("themeForName", () => {
  test("falls back to stet-dark for an unknown name", () => {
    expect(themeForName("does-not-exist")).toBe(stetDark);
  });
});

const channel = (hex: string, offset: number) => {
  const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;

  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

const luminance = (hex: string) =>
  0.2126 * channel(hex, 1) +
  0.7152 * channel(hex, 3) +
  0.0722 * channel(hex, 5);

const contrast = (foreground: string, background: string) => {
  const values = [luminance(foreground), luminance(background)].toSorted(
    (a, b) => b - a
  );

  return (values[0] + 0.05) / (values[1] + 0.05);
};

describe("built-in icon colors", () => {
  test("uses the curated file icon palette", () => {
    const coloredIcons = [
      "archive",
      "astro",
      "bun",
      "c",
      "codeowners",
      "cpp",
      "css",
      "csv",
      "database",
      "docker",
      "git",
      "go",
      "gradle",
      "graphql",
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
      "sass",
      "scala",
      "shell",
      "spreadsheet",
      "storybook",
      "svelte",
      "swift",
      "test",
      "toml",
      "tsconfig",
      "typescript",
      "video",
      "vue",
      "wasm",
      "yaml",
      "zig",
    ];

    expect(Object.keys(stetDark.icon)).toEqual(coloredIcons);
    expect(Object.keys(stetLight.icon)).toEqual(coloredIcons);
  });

  test("accounts for every built-in icon as colored or intentionally muted", () => {
    const mutedIcons = [
      "config",
      "document",
      "file",
      "folder",
      "folder-open",
      "font",
      "lock",
      "symlink",
      "template",
    ];

    expect(
      [...builtinIcons.keys()]
        .filter((icon) => stetDark.icon[icon] === undefined)
        .toSorted()
    ).toEqual(mutedIcons);
    expect(
      [...builtinIcons.keys()]
        .filter((icon) => stetLight.icon[icon] === undefined)
        .toSorted()
    ).toEqual(mutedIcons);
    expect(
      Object.keys(stetDark.icon).filter((icon) => !builtinIcons.has(icon))
    ).toEqual([]);
    expect(
      Object.keys(stetLight.icon).filter((icon) => !builtinIcons.has(icon))
    ).toEqual([]);
  });

  test("keeps every icon color visible across every built-in theme's surfaces", () => {
    const failures = builtinThemes
      .map(({ name }): [string, Theme] => [name, themeForName(name)])
      .flatMap(([appearance, theme]) =>
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
            .filter((result) => result.contrast < 3)
        )
      );

    expect(failures).toEqual([]);
  });
});

describe("monochrome themes", () => {
  test("the mono pair is built in", () => {
    expect(themeNames()).toContain("mono-dark");
    expect(themeNames()).toContain("mono-light");
  });

  test("every mono color is a pure grey; the colored built-ins are not", () => {
    expect(isMonochromeTheme(themeForName("mono-dark"))).toBe(true);
    expect(isMonochromeTheme(themeForName("mono-light"))).toBe(true);
    expect(isMonochromeTheme(stetDark)).toBe(false);
    expect(isMonochromeTheme(stetLight)).toBe(false);
  });

  test("an error stays more prominent than a warning without hue", () => {
    const dark = themeForName("mono-dark").severity;
    const light = themeForName("mono-light").severity;

    expect(luminance(dark.error)).toBeGreaterThan(luminance(dark.warning));
    expect(luminance(light.error)).toBeLessThan(luminance(light.warning));
  });

  test("one hue anywhere breaks monochrome", () => {
    const mono = themeForName("mono-dark");

    expect(
      isMonochromeTheme({ ...mono, icon: { ...mono.icon, lua: "#ff8800" } })
    ).toBe(false);
  });
});

describe("selectThemeName", () => {
  test("follows the appearance with stet's pair when the terminal gave no palette", () => {
    expect(selectThemeName(undefined, "dark")).toBe("stet-dark");
    expect(selectThemeName(undefined, "light")).toBe("stet-light");
  });

  test("prefers the terminal's own theme once it is registered", () => {
    const terminal = systemTheme({
      cursorColor: null,
      defaultBackground: "#202020",
      defaultForeground: "#e0e0e0",
      highlightBackground: null,
      highlightForeground: null,
      mouseBackground: null,
      mouseForeground: null,
      palette: Array.from({ length: 16 }, () => "#808080"),
      tekBackground: null,
      tekForeground: null,
    });

    expect(terminal).toBeDefined();
    registerSystemTheme(terminal ?? zedThemeForName("stet-dark"));

    expect(selectThemeName(undefined, "light")).toBe("system");
    expect(themeNames()[0]).toBe("system");
  });

  test("the built-ins' former names keep resolving", () => {
    expect(canonicalThemeName("dark")).toBe("stet-dark");
    expect(selectThemeName("dark", "light")).toBe("stet-dark");
    expect(selectThemeName({ dark: "dark", light: "light" }, "light")).toBe(
      "stet-light"
    );
  });

  test("opening the switcher on a dark/light pair keeps that theme", () => {
    registerSystemTheme(zedThemeForName("stet-dark"));
    setAppearance("dark");
    setSelection({ dark: "mono-dark", light: "mono-light" });
    state.openThemePicker();

    expect(activeThemeName()).toBe("mono-dark");

    state.closeThemePicker(false);

    expect(selection()).toEqual({ dark: "mono-dark", light: "mono-light" });
  });

  test("opening the switcher on a former built-in name keeps that theme", () => {
    setAppearance("light");
    setSelection("dark");
    state.openThemePicker();

    expect(activeThemeName()).toBe("stet-dark");

    state.closeThemePicker(true);

    expect(activeThemeName()).toBe("stet-dark");
    expect(selection()).toBe("stet-dark");
  });

  test("an unknown name renders the appearance's default and keeps the selection", () => {
    setAppearance("light");
    setSelection("gone-theme");

    expect(activeThemeName()).toBe("stet-light");
    expect(selection()).toBe("gone-theme");
  });

  test("a single name pins regardless of appearance", () => {
    expect(selectThemeName("gruvbox", "light")).toBe("gruvbox");
  });

  test("a pair follows the appearance", () => {
    expect(selectThemeName({ dark: "a", light: "b" }, "dark")).toBe("a");
    expect(selectThemeName({ dark: "a", light: "b" }, "light")).toBe("b");
  });
});

/** Makes one bundled theme's import reject; the test preload restores every loader. */
const failImport = (name: string) => {
  themes[name] = async () => await Promise.reject(new Error("import failed"));
};

describe("bundled themes", () => {
  test("a theme that fails to import is dropped from the list", async () => {
    failImport("dracula");
    await loadBundledThemes();

    expect(themeNames()).not.toContain("dracula");
    expect(hasTheme("dracula")).toBe(false);
    expect(themeNames()).toContain("nord");
  });

  test("the active theme failing to import resolves to not found, never a throw", async () => {
    failImport("dracula");
    await loadTheme("dracula");

    expect(hasTheme("dracula")).toBe(false);
  });
});

describe("systemTheme", () => {
  const colors = {
    cursorColor: null,
    defaultBackground: "#fafafa",
    defaultForeground: "#101010",
    highlightBackground: null,
    highlightForeground: null,
    mouseBackground: null,
    mouseForeground: null,
    palette: Array.from({ length: 16 }, (_, index) =>
      index === 2 ? "#00aa00" : "#777777"
    ),
    tekBackground: null,
    tekForeground: null,
  };

  test("builds a theme from the terminal's palette, light when its background is", () => {
    const theme = systemTheme(colors);

    expect(theme?.appearance).toBe("light");
    expect(theme?.style["terminal.ansi.green"]).toBe("#00aa00");
  });

  test("a palette reported mid-session replaces an existing system theme", () => {
    registerSystemTheme(zedThemeForName("stet-dark"));
    refreshTerminalPalette(colors);

    expect(zedThemeForName("system").style["terminal.ansi.green"]).toBe(
      "#00aa00"
    );
  });

  test("a palette reported mid-session never introduces system on its own", () => {
    refreshTerminalPalette(colors);

    expect(themeNames()).not.toContain("system");
  });

  test("declines a partial answer rather than mixing in guesses", () => {
    expect(
      systemTheme({
        ...colors,
        palette: [...colors.palette.slice(0, 15), null],
      })
    ).toBeUndefined();
    expect(systemTheme({ ...colors, defaultForeground: null })).toBeUndefined();
  });
});

describe("user themes", () => {
  test("a Zed theme file registers each theme under its slugged name", () => {
    const parsed = parseThemeFile(themeFile("My Theme", "#123456"));

    expect(parsed._tag).toBe("Success");

    if (parsed._tag === "Success") {
      registerThemes(parsed.success);
    }

    expect(themeNames()).toContain("my-theme");
    expect(themeForName("my-theme").surface.base).toBe("#123456");
    expect(themeForName("my-theme").kind.added).toBe("#00aa00");
  });

  test("keeps accented and non-Latin theme names distinct", () => {
    const parsed = parseThemeFile(
      JSON.stringify({
        themes: ["Rosé Pine", "夜", "朝"].map((name) => ({
          appearance: "dark",
          name,
          style: { "editor.background": "#000000" },
        })),
      })
    );

    expect(
      parsed._tag === "Success" ? parsed.success.map(([name]) => name) : []
    ).toEqual(["rose-pine", "夜", "朝"]);
  });

  test("lists user themes after the built-ins", () => {
    const parsed = parseThemeFile(themeFile("Registry Probe", "#000000"));

    if (parsed._tag === "Success") {
      registerThemes(parsed.success);
    }

    const names = themeNames();

    expect(names.indexOf("stet-dark")).toBeLessThan(
      names.indexOf("registry-probe")
    );
  });

  test("keeps code colors from scopes that write null font settings", () => {
    const parsed = parseThemeFile(
      JSON.stringify({
        themes: [
          {
            appearance: "dark",
            name: "Nulls",
            style: {
              "editor.background": "#000000",
              syntax: {
                comment: {
                  color: "#888888",
                  font_style: null,
                  font_weight: null,
                },
                keyword: { color: null },
                string: 7,
              },
            },
          },
        ],
      })
    );

    expect(
      parsed._tag === "Success" ? parsed.success[0]?.[1].style.syntax : {}
    ).toEqual({ comment: "#888888" });
  });

  test("an unreadable theme file is an issue, never a failed startup", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "stet-themes-"));

    try {
      writeFileSync(path.join(dir, "good.json"), themeFile("Good", "#101010"));
      writeFileSync(
        path.join(dir, "locked.json"),
        themeFile("Locked", "#202020")
      );
      chmodSync(path.join(dir, "locked.json"), 0o000);

      const { issues, themes: userThemes } = await readUserThemes(dir);

      expect([...userThemes.keys()]).toEqual(["good"]);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toContain("locked.json");
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("a theme with no letters or digits in its name is an issue, not a blank row", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "stet-themes-"));

    try {
      writeFileSync(
        path.join(dir, "symbols.json"),
        JSON.stringify({
          themes: ["🎨", "!!!"].map((name) => ({
            appearance: "dark",
            name,
            style: { "editor.background": "#000000" },
          })),
        })
      );

      const { issues, themes: userThemes } = await readUserThemes(dir);

      expect(userThemes.size).toBe(0);
      expect(issues).toEqual([
        'theme file symbols.json: theme "🎨" has no usable name',
        'theme file symbols.json: theme "!!!" has no usable name',
      ]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("a theme whose name an earlier one took is an issue, and the first one stays", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "stet-themes-"));

    try {
      writeFileSync(path.join(dir, "a.json"), themeFile("Foo Bar", "#111111"));
      writeFileSync(path.join(dir, "b.json"), themeFile("foo-bar", "#222222"));

      const { issues, themes: userThemes } = await readUserThemes(dir);

      expect(userThemes.get("foo-bar")?.name).toBe("Foo Bar");
      expect(issues).toEqual([
        'theme file b.json: theme "foo-bar" is listed as foo-bar, which "Foo Bar" already uses',
      ]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("user themes named after a name stet reserves are issues, not rows", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "stet-themes-"));

    try {
      writeFileSync(
        path.join(dir, "c.json"),
        JSON.stringify({
          themes: ["System", "Auto", "Dark", "Light"].map((name) => ({
            appearance: "dark",
            name,
            style: { "editor.background": "#333333" },
          })),
        })
      );

      const { issues, themes: userThemes } = await readUserThemes(dir);

      expect(userThemes.size).toBe(0);
      expect(issues).toEqual([
        'theme file c.json: theme "System" uses the reserved name system',
        'theme file c.json: theme "Auto" uses the reserved name auto',
        'theme file c.json: theme "Dark" uses the reserved name dark',
        'theme file c.json: theme "Light" uses the reserved name light',
      ]);
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("a missing themes directory yields nothing", async () => {
    expect(await readUserThemes("/nonexistent/stet/themes")).toEqual({
      issues: [],
      themes: new Map(),
    });
  });

  test("a file that is not a Zed theme is a failure, not a throw", () => {
    expect(parseThemeFile("{ nope")._tag).toBe("Failure");
    expect(parseThemeFile(JSON.stringify({ themes: [{ name: 1 }] }))._tag).toBe(
      "Failure"
    );
  });

  test("the active theme re-resolves when a user theme replaces its name", () => {
    setSelection("stet-dark");
    expect(activeTheme().colors.surface.base).toBe(stetDark.surface.base);

    const parsed = parseThemeFile(themeFile("stet-dark", "#123456"));

    if (parsed._tag === "Success") {
      registerThemes(parsed.success);
    }

    expect(activeTheme().colors.surface.base).toBe("#123456");
  });
});
