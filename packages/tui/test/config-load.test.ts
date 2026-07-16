import { describe, expect, test } from "bun:test";

import { loadConfigText } from "@/config/load";
import { darkTheme } from "@/theme/dark";

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

  test("a non-object config falls back to defaults with an issue", () => {
    const { config, issues } = loadConfigText(`[1, 2]`);

    expect(config).toEqual({});
    expect(issues).toEqual(["config must be a JSONC object"]);
  });

  test("accepts editor and ide templates", () => {
    const { config, issues } = loadConfigText(`{
      "editor": "nvim +{line} {file}",
      "ide": "code --goto {file}:{line}"
    }`);

    expect(issues).toEqual([]);
    expect(config.editor).toBe("nvim +{line} {file}");
    expect(config.ide).toBe("code --goto {file}:{line}");
  });

  test("a wrong-typed editor is rejected", () => {
    const { config, issues } = loadConfigText(`{ "editor": 42 }`);

    expect(config).toEqual({});
    expect(issues).toHaveLength(1);
  });

  test("an empty editor string is rejected", () => {
    const { config, issues } = loadConfigText(`{ "editor": "" }`);

    expect(config).toEqual({});
    expect(issues).toHaveLength(1);
  });

  test("a wrong-typed ide is rejected", () => {
    const { config, issues } = loadConfigText(`{ "ide": true }`);

    expect(config).toEqual({});
    expect(issues).toHaveLength(1);
  });

  test("an empty ide string is rejected", () => {
    const { config, issues } = loadConfigText(`{ "ide": "" }`);

    expect(config).toEqual({});
    expect(issues).toHaveLength(1);
  });

  test("a wrong-typed selection is rejected", () => {
    const { config, issues } = loadConfigText(`{ "theme": 42 }`);

    expect(config).toEqual({});
    expect(issues).toHaveLength(1);
  });

  test("registry entries load raw; their resolvers validate them later", () => {
    const { config, issues } = loadConfigText(
      `{ "files": { "lua": { "extensions": ["lua"], "language": "lua" } }, "languages": { "lua": { "languageId": "lua", "servers": ["lua"] } }, "diagnostics": { "servers": { "lua": { "command": ["lua-language-server"] } } } }`,
    );

    expect(issues).toEqual([]);
    expect(config.files).toMatchObject({ lua: { extensions: ["lua"] } });
    expect(config.languages).toMatchObject({ lua: { languageId: "lua" } });
    expect(config.diagnostics?.servers).toMatchObject({
      lua: { command: ["lua-language-server"] },
    });
  });

  test("feature sections decode", () => {
    const { config, issues } = loadConfigText(`{
      "icons": { "enabled": false, "glyphs": { "typescript": "" } },
      "viewer": { "wrap": true },
      "sidebar": { "open": false, "width": 40, "changesOnly": true },
      "provenance": { "enabled": true },
      "diagnostics": { "enabled": false, "download": false },
      "intel": { "enabled": false },
      "update": { "check": false },
      "search": { "regex": true, "caseSensitive": true, "scope": "repo" }
    }`);

    expect(issues).toEqual([]);
    expect(config.icons).toEqual({ enabled: false, glyphs: { typescript: "" } });
    expect(config.viewer).toEqual({ wrap: true });
    expect(config.sidebar).toEqual({ changesOnly: true, open: false, width: 40 });
    expect(config.provenance).toEqual({ enabled: true });
    expect(config.diagnostics).toEqual({ download: false, enabled: false });
    expect(config.intel).toEqual({ enabled: false });
    expect(config.update).toEqual({ check: false });
    expect(config.search).toEqual({ caseSensitive: true, regex: true, scope: "repo" });
  });

  test("an unknown top-level key is reported and the rest still loads", () => {
    const { config, issues } = loadConfigText(`{ "them": "gruvbox", "theme": "gruvbox" }`);

    expect(config.theme).toBe("gruvbox");
    expect(issues).toEqual(['config: unknown key "them"']);
  });

  test("an unknown key inside a section is reported and the rest of it kept", () => {
    const { config, issues } = loadConfigText(`{ "viewer": { "warp": true, "wrap": true } }`);

    expect(config.viewer).toEqual({ wrap: true });
    expect(issues).toEqual(['config viewer: unknown key "warp"']);
  });

  test("a bad value drops only its own section", () => {
    const { config, issues } = loadConfigText(
      `{ "viewer": { "wrap": "yes" }, "theme": "gruvbox" }`,
    );

    expect(config.theme).toBe("gruvbox");
    expect(config.viewer).toBeUndefined();
    expect(issues).toHaveLength(1);
  });

  test("the pre-restructure servers key points at its new home", () => {
    const { config, issues } = loadConfigText(
      `{ "servers": { "lua": { "command": ["lua-language-server"] } } }`,
    );

    expect(config).toEqual({});
    expect(issues).toEqual(['config: "servers" moved to "diagnostics.servers"']);
  });

  test("pre-restructure flat icon glyphs point at icons.glyphs", () => {
    const { config, issues } = loadConfigText(`{ "icons": { "typescript": "" } }`);

    expect(config.icons).toEqual({});
    expect(issues).toEqual([
      'config icons: unknown key "typescript" (glyph overrides moved to "icons.glyphs")',
    ]);
  });

  test("sidebar width must be a positive integer", () => {
    expect(loadConfigText(`{ "sidebar": { "width": 0 } }`).issues).toHaveLength(1);
    expect(loadConfigText(`{ "sidebar": { "width": 40.5 } }`).issues).toHaveLength(1);
    expect(loadConfigText(`{ "sidebar": { "width": 40 } }`).config.sidebar?.width).toBe(40);
  });

  test("a stray key on a theme selection pair is reported", () => {
    const { config, issues } = loadConfigText(
      `{ "theme": { "dark": "a", "light": "b", "darkk": "c" } }`,
    );

    expect(config.theme).toEqual({ dark: "a", light: "b" });
    expect(issues).toEqual(['config theme: unknown key "darkk"']);
  });
});
