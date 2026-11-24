import { describe, expect, test } from "bun:test";

import { builtinIcons } from "@/file-support/builtins";
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
    ["data.xlsx", "spreadsheet", "\u{E6A6}"],
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

  test("stet's rules override Trees for tests, stories, and ecosystem files", () => {
    expect(fileIconForPath("main.test.ts").name).toBe("test");
    expect(fileIconForPath("api.spec.tsx").name).toBe("test");
    expect(fileIconForPath("test_main.py").name).toBe("test");
    expect(fileIconForPath("App.stories.tsx").name).toBe("storybook");
    expect(fileIconForPath("package.json").name).toBe("node");
    expect(fileIconForPath("README.md").name).toBe("readme");
    expect(fileIconForPath("LICENSE").name).toBe("license");
    expect(fileIconForPath("data.csv").name).toBe("csv");
  });

  test("fills extensions and dotfiles Trees does not recognize", () => {
    expect(fileIconForPath("Main.java").name).toBe("java");
    expect(fileIconForPath("Cargo.lock").name).toBe("lock");
    expect(fileIconForPath("Cargo.toml").name).toBe("toml");
    expect(fileIconForPath(".unknownrc").name).toBe("config");
    expect(fileIconForPath("view.rb.tmpl").name).toBe("ruby");
  });

  test("license and readme rules match documents, not code named after them", () => {
    expect(fileIconForPath("LICENSE.md").name).toBe("license");
    expect(fileIconForPath("LICENSE-MIT").name).toBe("license");
    expect(fileIconForPath("LICENSE-APACHE.txt").name).toBe("license");
    expect(fileIconForPath("CC0-1.0.txt").name).toBe("license");
    expect(fileIconForPath("CC0-1.0").name).toBe("license");
    expect(fileIconForPath("LICENSE.markdown").name).toBe("license");
    expect(fileIconForPath("LICENSE-CODE").name).toBe("license");
    expect(fileIconForPath("LICENSE_1_0.txt").name).toBe("license");
    expect(fileIconForPath("License.tsx").name).toBe("react");
    expect(fileIconForPath("licenses.json").name).toBe("json");
    expect(fileIconForPath("license-checker.config.js").name).toBe(
      "javascript"
    );
    expect(fileIconForPath("README.rst").name).toBe("readme");
    expect(fileIconForPath("Readme.adoc").name).toBe("readme");
    expect(fileIconForPath("Readme.tsx").name).toBe("react");
    expect(fileIconForPath("README.zh-CN.md").name).toBe("readme");
    expect(fileIconForPath("CC-BY-SA-4.0.txt").name).toBe("license");
    expect(fileIconForPath("COPYING.LESSER").name).toBe("license");
    expect(fileIconForPath("license_1.tsx").name).toBe("react");
    expect(fileIconForPath("license-gpl.ts").name).toBe("typescript");
    expect(fileIconForPath("License.java").name).toBe("java");
    expect(fileIconForPath("ReadmeGenerator.kt").name).toBe("kotlin");
    expect(fileIconForPath("readmeta.txt").name).toBe("document");
    expect(fileIconForPath("COPYING3").name).toBe("license");
    expect(fileIconForPath("NOTICE.txt").name).toBe("license");
    expect(fileIconForPath("gpl-3.0.txt").name).toBe("license");
  });

  test("keeps Trees' filename tokens over the fallback extensions", () => {
    expect(fileIconForPath("bun.lock").name).toBe("bun");
    expect(fileIconForPath(".gitignore").name).toBe("git");
    expect(fileIconForPath("bunfig.toml").name).toBe("bun");
  });

  test("every catalog file glyph has a rule that reaches it", () => {
    const samples = new Map([
      ["archive", "a.zip"],
      ["astro", "a.astro"],
      ["bun", "bun.lock"],
      ["c", "a.c"],
      ["codeowners", "CODEOWNERS"],
      ["config", ".unknownrc"],
      ["cpp", "a.cpp"],
      ["css", "a.css"],
      ["csv", "a.csv"],
      ["database", "a.sql"],
      ["docker", "Dockerfile"],
      ["document", "a.txt"],
      ["file", "a.unknown"],
      ["font", "a.woff2"],
      ["git", ".gitignore"],
      ["go", "go.mod"],
      ["gradle", "build.gradle"],
      ["graphql", "a.graphql"],
      ["groovy", "a.groovy"],
      ["heroku", "Procfile"],
      ["html", "a.html"],
      ["http", "a.http"],
      ["image", "a.png"],
      ["java", "A.java"],
      ["javascript", "a.js"],
      ["json", "a.json"],
      ["kotlin", "a.kt"],
      ["license", "LICENSE"],
      ["lock", "Cargo.lock"],
      ["make", "Makefile"],
      ["markdown", "a.md"],
      ["maven", "pom.xml"],
      ["node", "package.json"],
      ["pdf", "a.pdf"],
      ["profile", "a.cpuprofile"],
      ["python", "a.py"],
      ["react", "a.tsx"],
      ["readme", "README.md"],
      ["ruby", "a.rb"],
      ["rust", "a.rs"],
      ["sass", "a.scss"],
      ["scala", "a.scala"],
      ["shell", "a.sh"],
      ["spreadsheet", "a.xlsx"],
      ["storybook", "a.stories.tsx"],
      ["svelte", "a.svelte"],
      ["swift", "a.swift"],
      ["template", "a.mako"],
      ["test", "a.test.ts"],
      ["toml", "Cargo.toml"],
      ["tsconfig", "tsconfig.json"],
      ["typescript", "a.ts"],
      ["video", "a.mp4"],
      ["vue", "a.vue"],
      ["wasm", "a.wasm"],
      ["yaml", "a.yaml"],
      ["zig", "a.zig"],
    ]);

    const chrome = new Set(["folder", "folder-open", "symlink"]);

    expect(new Set(samples.keys())).toEqual(
      new Set(builtinIcons.keys()).difference(chrome)
    );

    for (const [name, path] of samples) {
      expect(fileIconForPath(path).name).toBe(name);
    }
  });

  test("matches names and extensions case-insensitively", () => {
    expect(fileIcon("MAIN.TS")).toBe(fileIcon("main.ts"));
    expect(fileIcon("Dockerfile")).toBe(fileIcon("dockerfile"));
    expect(fileIcon("PAGE.MDX.TSX")).toBe(fileIcon("page.mdx.tsx"));
  });

  test("uses the generic glyph for paths nothing recognizes", () => {
    expect(fileIconForPath("notes.unknown")).toEqual(namedIcon("file"));
    expect(fileIconForPath("NOTES")).toEqual(namedIcon("file"));
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
