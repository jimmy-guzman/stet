import { describe, expect, test } from "bun:test";

import { fileIconForPath, namedIcon } from "@/file-support/registry";

const fileIcon = (path: string) => fileIconForPath(path).glyph;

describe("fileIcon", () => {
  test("matches by extension", () => {
    expect(fileIcon("main.ts")).toBe("\u{E8CA}");
    expect(fileIcon("App.tsx")).toBe("\u{E7BA}");
    expect(fileIcon("readme.css")).toBe("\u{E749}");
    expect(fileIcon("notes.md")).toBe("\u{EB1D}");
    expect(fileIcon("guide.mdx")).toBe("\u{EB1D}");
  });

  test("treats .mts and .cts as TypeScript", () => {
    expect(fileIcon("config.mts")).toBe("\u{E8CA}");
    expect(fileIcon("config.cts")).toBe("\u{E8CA}");
  });

  test("matches csv and http by extension", () => {
    expect(fileIcon("data.csv")).toBe("\u{E64A}");
    expect(fileIcon("requests.http")).toBe("\u{F1D8}");
  });

  test("pairs xls/xlsx in the Seti spreadsheet family, distinct from csv", () => {
    expect(fileIcon("book.xls")).toBe("\u{E6A6}");
    expect(fileIcon("book.xlsx")).toBe("\u{E6A6}");
    // A workbook is not a CSV: same Seti family, different glyph.
    expect(fileIcon("book.xlsx")).not.toBe(fileIcon("data.csv"));
  });

  test("marks a .cpuprofile with the flame glyph", () => {
    expect(fileIcon("CPU-20250101.cpuprofile")).toBe("\u{EAF2}");
    expect(fileIcon("CPU-20250101.cpuprofile")).not.toBe("\u{EA7B}");
  });

  test("marks .sql with the database glyph and .txt with the document glyph", () => {
    expect(fileIcon("schema.sql")).toBe("\u{E706}");
    expect(fileIcon("schema.sql")).not.toBe("\u{EA7B}");
    expect(fileIcon("notes.txt")).toBe("\u{F0219}");
    // A license .txt keeps the license glyph: the license check beats the extension.
    expect(fileIcon("notes.txt")).not.toBe(fileIcon("LICENSE.txt"));
  });

  test("marks .ini with the config glyph, like .conf", () => {
    expect(fileIcon("alembic.ini")).toBe("\u{E615}");
    expect(fileIcon("alembic.ini")).toBe(fileIcon("nginx.conf"));
    expect(fileIcon("tox.ini")).not.toBe("\u{EA7B}");
  });

  test("marks a .mako template with the template glyph, not its rendered language", () => {
    expect(fileIcon("script.py.mako")).toBe("\u{F505}");
    expect(fileIcon("base.mako")).toBe("\u{F505}");
    // A Python template is a template: it does not get the .py glyph.
    expect(fileIcon("script.py.mako")).not.toBe(fileIcon("main.py"));
  });

  test("marks an extensionless README with the book glyph", () => {
    expect(fileIcon("README")).toBe("\u{EAA4}");
    expect(fileIcon("README")).toBe(fileIcon("readme.md"));
    // Only the exact name is a readme, so an extension still wins on any other readme.* file.
    expect(fileIcon("readme.css")).toBe("\u{E749}");
  });

  test("marks Procfile with the Heroku glyph by exact filename", () => {
    expect(fileIcon("Procfile")).toBe("\u{E607}");
    expect(fileIcon("procfile")).toBe(fileIcon("Procfile"));
    expect(fileIcon("Procfile")).not.toBe("\u{EA7B}");
  });

  test("marks CODEOWNERS with the shield glyph by exact filename", () => {
    expect(fileIcon("CODEOWNERS")).toBe("\u{F510}");
    expect(fileIcon("codeowners")).toBe("\u{F510}");
    // A plain uppercase file with no rule stays generic.
    expect(fileIcon("CODEOWNERS")).not.toBe(fileIcon("AUTHORS"));
  });

  test("marks NOTICE with the license glyph, like LICENSE", () => {
    expect(fileIcon("NOTICE")).toBe("\u{E60A}");
    expect(fileIcon("NOTICE")).toBe(fileIcon("LICENSE"));
  });

  test("marks license-style filenames with the license glyph, beating any extension", () => {
    expect(fileIcon("LICENSE.md")).toBe("\u{E60A}");
    expect(fileIcon("LICENSE.txt")).toBe("\u{E60A}");
    expect(fileIcon("COPYING")).toBe("\u{E60A}");
    expect(fileIcon("UNLICENSE")).toBe("\u{E60A}");
    expect(fileIcon("MIT")).toBe("\u{E60A}");
    // Creative Commons license files, including the reported CC-BY-NC-SA-4.0.
    expect(fileIcon("CC-BY-NC-SA-4.0")).toBe("\u{E60A}");
    expect(fileIcon("CC0-1.0")).toBe("\u{E60A}");
    // A License name beats its extension, not the other way around.
    expect(fileIcon("LICENSE.md")).not.toBe(fileIcon("readme.md"));
  });

  test("matches astro, vue, pdf, and video files by extension", () => {
    expect(fileIcon("index.astro")).toBe("\u{E6B3}");
    expect(fileIcon("App.vue")).toBe("\u{E6A0}");
    expect(fileIcon("report.pdf")).toBe("\u{F1C1}");
    expect(fileIcon("clip.mp4")).toBe("\u{F1C8}");
    expect(fileIcon("clip.mkv")).toBe(fileIcon("clip.mp4"));
    expect(fileIcon("clip.webm")).toBe(fileIcon("clip.mp4"));
    // Webp stays an image, not a video.
    expect(fileIcon("hero.webp")).not.toBe(fileIcon("clip.mp4"));
  });

  test("shares one image glyph across image formats", () => {
    expect(fileIcon("photo.jpeg")).toBe("\u{F1C5}");
    expect(fileIcon("anim.gif")).toBe("\u{F1C5}");
    expect(fileIcon("hero.webp")).toBe("\u{F1C5}");
    expect(fileIcon("favicon.ico")).toBe("\u{F1C5}");
  });

  test("prefers an exact filename over its extension", () => {
    // Package.json is a json file, but the stem entry beats the .json extension glyph.
    expect(fileIcon("package.json")).toBe("\u{E718}");
    expect(fileIconForPath("package.json").name).toBe("node");
    expect(fileIcon("package.json")).not.toBe(fileIcon("generic.json"));
    // Bunfig.toml gets the bun glyph, not the generic toml glyph.
    expect(fileIcon("bunfig.toml")).toBe("\u{E76F}");
    expect(fileIcon("bunfig.toml")).not.toBe(fileIcon("generic.toml"));
  });

  test("matches JVM source extensions", () => {
    expect(fileIcon("Main.java")).toBe("\u{E738}");
    expect(fileIcon("App.kt")).toBe("\u{E634}");
    expect(fileIcon("script.kts")).toBe("\u{E634}");
    expect(fileIcon("Build.groovy")).toBe("\u{E775}");
    expect(fileIcon("Spec.gvy")).toBe("\u{E775}");
    expect(fileIcon("App.scala")).toBe("\u{E737}");
    expect(fileIcon("worksheet.sc")).toBe("\u{E737}");
  });

  test("shares the Java glyph across compiled artifacts", () => {
    expect(fileIcon("lib.jar")).toBe(fileIcon("Main.java"));
    expect(fileIcon("Main.class")).toBe(fileIcon("Main.java"));
  });

  test("marks Gradle/Maven build files with the build glyph, beating their extension", () => {
    expect(fileIcon("build.gradle")).toBe("\u{E7F2}");
    expect(fileIcon("settings.gradle")).toBe("\u{E7F2}");
    expect(fileIcon("gradlew")).toBe("\u{E7F2}");
    expect(fileIcon("gradle-wrapper.properties")).toBe("\u{E7F2}");
    expect(fileIcon("pom.xml")).toBe("\u{E674}");
    // Build.gradle.kts gets the Gradle glyph, not the .kts kotlin glyph.
    expect(fileIcon("build.gradle.kts")).toBe("\u{E7F2}");
    expect(fileIcon("build.gradle.kts")).not.toBe(fileIcon("script.kts"));
  });

  test("matches Ruby files, and peels a .rb.tmpl template to the Ruby glyph", () => {
    expect(fileIcon("Formula.rb")).toBe("\u{E739}");
    expect(fileIcon("stet.rb.tmpl")).toBe("\u{E739}");
    expect(fileIcon("stet.rb.tmpl")).toBe(fileIcon("Formula.rb"));
    // Only .rb.tmpl is peeled: other .tmpl files and a bare .tmpl stay generic.
    expect(fileIcon("config.yaml.tmpl")).toBe("\u{EA7B}");
    expect(fileIcon("release.tmpl")).toBe("\u{EA7B}");
  });

  test("marks .conf files with the config glyph", () => {
    expect(fileIcon("nginx.conf")).toBe("\u{E615}");
    expect(fileIcon("redis.conf")).toBe("\u{E615}");
    expect(fileIcon("nginx.conf")).toBe(fileIcon(".editorconfig"));
  });

  test("falls back to a config glyph for unmatched dotfiles", () => {
    expect(fileIcon(".editorconfig")).toBe("\u{E615}");
    expect(fileIcon(".npmrc")).toBe("\u{E615}");
    expect(fileIcon(".ts")).toBe(fileIcon(".npmrc"));
    expect(fileIcon(".ts")).not.toBe(fileIcon("main.ts"));
    // A recognized suffix still wins over the dotfile fallback.
    expect(fileIcon(".prettierrc.json")).toBe("\u{F0626}");
  });

  test("matches dotfiles by full name", () => {
    expect(fileIcon(".gitignore")).toBe("\u{F02A2}");
    expect(fileIcon("nested/.gitignore")).toBe(fileIcon(".gitignore"));
  });

  test("is case-insensitive", () => {
    expect(fileIcon("MAIN.TS")).toBe(fileIcon("main.ts"));
    expect(fileIcon("Dockerfile")).toBe(fileIcon("dockerfile"));
  });

  test("falls back to a generic file glyph", () => {
    expect(fileIcon("notes.xyz")).toBe("\u{EA7B}");
    expect(fileIcon("AUTHORS")).toBe("\u{EA7B}");
  });

  test("marks test/spec files with one shared glyph, regardless of language", () => {
    expect(fileIcon("foo.test.ts")).toBe("\u{EA79}");
    expect(fileIcon("App.spec.tsx")).toBe("\u{EA79}");
    expect(fileIcon("e2e.cy.js")).toBe("\u{EA79}");
    expect(fileIcon("foo_test.go")).toBe("\u{EA79}");
    expect(fileIcon("bar_spec.rb")).toBe("\u{EA79}");
    expect(fileIcon("test_foo.py")).toBe("\u{EA79}");
    // A React test is not given its own icon: one glyph means "this is a test".
    expect(fileIcon("App.test.tsx")).toBe(fileIcon("foo.test.ts"));
  });

  test("does not treat a bare test/spec filename, or a word ending in test, as a test file", () => {
    expect(fileIcon("test.ts")).toBe(fileIcon("main.ts"));
    expect(fileIcon("spec.rb")).toBe(fileIcon("Formula.rb"));
    expect(fileIcon("latest.ts")).toBe(fileIcon("main.ts"));
    expect(fileIcon("contest.go")).not.toBe("\u{EA79}");
  });

  test("marks Storybook story files with the storybook glyph", () => {
    expect(fileIcon("Button.stories.tsx")).toBe("\u{E8B3}");
    expect(fileIcon("Button.story.ts")).toBe("\u{E8B3}");
    expect(fileIcon("Button.stories.tsx")).not.toBe(
      fileIcon("Button.test.tsx")
    );
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
