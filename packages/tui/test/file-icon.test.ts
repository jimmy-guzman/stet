import { describe, expect, test } from "bun:test";

import { fileIconForPath, namedIcon } from "@/file-support/registry";

const fileIcon = (path: string) => fileIconForPath(path).glyph;

describe("fileIcon", () => {
  test.each([
    ["main.ts", "typescript", "\u{E8CA}"],
    ["App.tsx", "react", "\u{E7BA}"],
    ["main.cpp", "cpp", "\u{E61D}"],
    ["Main.swift", "swift", "\u{E755}"],
    ["main.zig", "zig", "\u{E8EF}"],
    ["App.svelte", "svelte", "\u{E8B7}"],
    ["style.scss", "sass", "\u{E74B}"],
    ["schema.graphql", "graphql", "\u{E7F4}"],
    ["module.wasm", "wasm", "\u{E8E0}"],
    ["font.woff2", "font", "\u{F031}"],
    ["src/.bashrc", "shell", "\u{EBCA}"],
    ["config.yaml", "yaml", "\u{E8EB}"],
    ["data.csv", "spreadsheet", "\u{E6A6}"],
    ["notes.txt", "document", "\u{F0219}"],
    ["logo.svg", "image", "\u{F1C5}"],
    ["bundle.tar.gz", "archive", "\u{F1C6}"],
  ])("maps Trees' category for %s to a terminal icon", (path, name, glyph) => {
    expect(fileIconForPath(path)).toEqual({ glyph, name });
  });

  test("uses Trees' exact filenames and multipart extensions", () => {
    expect(fileIconForPath("src/bunfig.toml").name).toBe("bun");
    expect(fileIconForPath("compose.yaml").name).toBe("docker");
    expect(fileIconForPath(".prettierrc.json").name).toBe("config");
    expect(fileIconForPath("page.mdx.tsx").name).toBe("markdown");
    expect(fileIconForPath("page.tsx").name).toBe("react");
  });

  test("uses Trees' defaults for package files, tests, and stories", () => {
    expect(fileIconForPath("package.json").name).toBe("json");
    expect(fileIconForPath("README.md").name).toBe("markdown");
    expect(fileIconForPath("main.test.ts").name).toBe("typescript");
    expect(fileIconForPath("App.stories.tsx").name).toBe("react");
    expect(fileIconForPath("test_main.py").name).toBe("python");
  });

  test("matches names and extensions case-insensitively", () => {
    expect(fileIcon("MAIN.TS")).toBe(fileIcon("main.ts"));
    expect(fileIcon("Dockerfile")).toBe(fileIcon("dockerfile"));
    expect(fileIcon("PAGE.MDX.TSX")).toBe(fileIcon("page.mdx.tsx"));
  });

  test("uses the generic glyph for paths Trees does not recognize", () => {
    expect(fileIconForPath("notes.unknown")).toEqual(namedIcon("file"));
    expect(fileIconForPath("README")).toEqual(namedIcon("file"));
    expect(fileIconForPath(".unknown")).toEqual(namedIcon("file"));
  });
});

describe("namedIcon", () => {
  test("folder and folder-open are distinct glyphs", () => {
    expect(namedIcon("folder-open").glyph).toBe("\u{F0DCF}");
    expect(namedIcon("folder").glyph).toBe("\u{F0256}");
    expect(namedIcon("folder-open").glyph).not.toBe(namedIcon("folder").glyph);
  });

  test("symlink is its own glyph, independent of the target name", () => {
    expect(namedIcon("symlink").glyph).toBe("\u{F481}");
    expect(namedIcon("symlink").glyph).not.toBe(fileIcon("link.ts"));
  });
});
