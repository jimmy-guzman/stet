import { describe, expect, test } from "bun:test";

import { loadConfigText } from "../src/config/load";
import { darkTheme } from "../src/theme/dark";

describe("loadConfigText", () => {
  test("parses JSONC with comments and trailing commas", () => {
    const { config, issues } = loadConfigText(`{
      // pick a theme
      "theme": "gruvbox",
    }`);

    expect(issues).toEqual([]);
    expect(config.theme).toBe("gruvbox");
  });

  test("accepts an appearance-keyed selection pair", () => {
    const { config, issues } = loadConfigText(`{ "theme": { "dark": "a", "light": "b" } }`);

    expect(issues).toEqual([]);
    expect(config.theme).toEqual({ dark: "a", light: "b" });
  });

  test("accepts a full theme object", () => {
    const { config, issues } = loadConfigText(JSON.stringify({ themes: { mine: darkTheme } }));

    expect(issues).toEqual([]);
    expect(config.themes?.mine).toEqual(darkTheme);
  });

  test("an empty config is valid", () => {
    expect(loadConfigText("{}")).toEqual({ config: {}, issues: [] });
  });

  test("malformed JSONC falls back to defaults with an issue", () => {
    const { config, issues } = loadConfigText(`{ "theme": `);

    expect(config).toEqual({});
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("not valid JSONC");
  });

  test("a non-hex theme color is rejected with a path-bearing issue", () => {
    const broken = { ...darkTheme, accent: { primary: "red" } };
    const { config, issues } = loadConfigText(JSON.stringify({ themes: { mine: broken } }));

    expect(config).toEqual({});
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain("accent");
    expect(issues[0]).toContain("primary");
  });

  test("a wrong-typed selection is rejected", () => {
    const { config, issues } = loadConfigText(`{ "theme": 42 }`);

    expect(config).toEqual({});
    expect(issues).toHaveLength(1);
  });
});
