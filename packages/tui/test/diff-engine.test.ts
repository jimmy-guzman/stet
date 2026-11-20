import { describe, expect, test } from "bun:test";

import { languageForPath, renderDiff } from "@/diff/engine";
import { isLineRow } from "@/diff/rows";
import { resolveFileSupportConfig } from "@/file-support/config";
import { registerFileSupport } from "@/file-support/registry";
import { setSelection } from "@/theme/active";
import { ansiFromSlots, paletteTheme } from "@/theme/palette";
import { loadTheme, registerSystemTheme } from "@/theme/registry";

const patch = `diff --git a/foo.ts b/foo.ts
index 1111111..2222222 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,4 +1,4 @@
 const a = 1;
-const b = "two";
+const b = "three";
 const c = 4;
 const d = 5;
`;

// Two different files (distinct fingerprints, so no cache/in-flight de-dup) rendered
// Together must both come back highlighted: neither may cache plain-text spans while
// The shared highlighter is still resolving its theme.
const goPatch = (name: string, body: string) => `diff --git a/${name} b/${name}
index 1111111..2222222 100644
--- a/${name}
+++ b/${name}
@@ -1,1 +1,1 @@
-old
+${body}
`;

describe("renderDiff", () => {
  test("parses, highlights, and builds the unified row model from a real patch", async () => {
    const render = await renderDiff({ full: false, maxLines: 1600, patch });

    expect(render.hiddenLines).toBe(0);
    expect(render.navigable).toHaveLength(5);
    expect(render.navigable[1]).toMatchObject({
      content: 'const b = "two";',
      oldLine: 2,
      type: "remove",
    });

    const added = render.rows
      .filter(isLineRow)
      .find((row) => row.type === "add");

    if (added === undefined) {
      throw new Error("expected an addition row");
    }

    // The reconstructed text is exact, and the highlighter colored it (plain text is one
    // Foreground color, so distinct colors are what say it highlighted).
    expect(added.spans.map((span) => span.text).join("")).toBe(
      'const b = "three";'
    );
    expect(new Set(added.spans.map((span) => span.fg)).size).toBeGreaterThan(1);
    expect(added.newLine).toBe(2);
  });

  test("resolves an empty render for an empty patch", async () => {
    const { hiddenLines, navigable, rows } = await renderDiff({
      full: false,
      maxLines: 1600,
      patch: "",
    });

    expect({ hiddenLines, navigable, rows }).toEqual({
      hiddenLines: 0,
      navigable: [],
      rows: [],
    });
  });

  test("serves an identical patch from the byte-capped cache by reference", async () => {
    // A second render of the same fingerprint returns the cached render object itself, not a
    // Recompute, confirming the size-tracking cache wrapper still resolves hits to `.render`.
    const first = await renderDiff({ full: false, maxLines: 1600, patch });
    const second = await renderDiff({ full: false, maxLines: 1600, patch });
    expect(second).toBe(first);
  });

  test("highlights a Rust diff", async () => {
    const rustPatch = `diff --git a/main.rs b/main.rs
index 1111111..2222222 100644
--- a/main.rs
+++ b/main.rs
@@ -1,1 +1,1 @@
-let total: u32 = 0;
+let total: u32 = sum(items);
`;

    const render = await renderDiff({
      full: false,
      maxLines: 1600,
      patch: rustPatch,
    });

    const added = render.rows
      .filter(isLineRow)
      .find((row) => row.type === "add");

    if (added === undefined) {
      throw new Error("expected an addition row");
    }

    expect(added.spans.map((span) => span.text).join("")).toBe(
      "let total: u32 = sum(items);"
    );
    expect(new Set(added.spans.map((span) => span.fg)).size).toBeGreaterThan(1);
  });

  test("highlights both files when two diffs render concurrently", async () => {
    const [first, second] = await Promise.all([
      renderDiff({
        full: false,
        maxLines: 1600,
        patch: goPatch("first.go", "func add(a int) int {"),
      }),
      renderDiff({
        full: false,
        maxLines: 1600,
        patch: goPatch("second.go", "func sub(b int) int {"),
      }),
    ]);

    for (const render of [first, second]) {
      const added = render.rows
        .filter(isLineRow)
        .find((row) => row.type === "add");

      if (added === undefined) {
        throw new Error("expected an addition row");
      }

      expect(new Set(added.spans.map((span) => span.fg)).size).toBeGreaterThan(
        1
      );
    }
  });

  test("renders a subdirectory Dockerfile with syntax highlighting", async () => {
    // An extensionless filename key resolves only against the basename; before that fix a
    // Dockerfile in any directory fell through to plain text.
    const dockerPatch = `diff --git a/docker/Dockerfile b/docker/Dockerfile
index 1111111..2222222 100644
--- a/docker/Dockerfile
+++ b/docker/Dockerfile
@@ -1,1 +1,1 @@
-FROM node:18
+FROM oven/bun:1
`;

    const render = await renderDiff({
      full: false,
      maxLines: 1600,
      patch: dockerPatch,
    });

    const added = render.rows
      .filter(isLineRow)
      .find((row) => row.type === "add");

    if (added === undefined) {
      throw new Error("expected an addition row");
    }

    expect(added.spans.map((span) => span.text).join("")).toBe(
      "FROM oven/bun:1"
    );
    expect(new Set(added.spans.map((span) => span.fg)).size).toBeGreaterThan(1);
  });

  test("renders an .npmrc with syntax highlighting", async () => {
    const npmrcPatch = `diff --git a/.npmrc b/.npmrc
index 1111111..2222222 100644
--- a/.npmrc
+++ b/.npmrc
@@ -1,1 +1,1 @@
-save-exact=false
+save-exact=true
`;

    const render = await renderDiff({
      full: false,
      maxLines: 1600,
      patch: npmrcPatch,
    });

    const added = render.rows
      .filter(isLineRow)
      .find((row) => row.type === "add");

    if (added === undefined) {
      throw new Error("expected an addition row");
    }

    expect(added.spans.map((span) => span.text).join("")).toBe(
      "save-exact=true"
    );
    expect(new Set(added.spans.map((span) => span.fg)).size).toBeGreaterThan(1);
  });

  test("renders an unknown extension as plain text without throwing", async () => {
    const unknownPatch = `diff --git a/notes.zzzz b/notes.zzzz
index 1111111..2222222 100644
--- a/notes.zzzz
+++ b/notes.zzzz
@@ -1,1 +1,1 @@
-old line
+new line here
`;

    const render = await renderDiff({
      full: false,
      maxLines: 1600,
      patch: unknownPatch,
    });

    const added = render.rows
      .filter(isLineRow)
      .find((row) => row.type === "add");

    if (added === undefined) {
      throw new Error("expected an addition row");
    }

    expect(added.spans.map((span) => span.text).join("")).toBe("new line here");
  });
});

/** A `system` theme whose terminal green, and so its string color, is `green`. */
const terminal = (green: string) =>
  paletteTheme("system", "dark", {
    ansi: ansiFromSlots([
      "#000000",
      "#ff0000",
      green,
      "#ffff00",
      "#0000ff",
      "#ff00ff",
      "#00ffff",
      "#c0c0c0",
    ]),
    background: "#101010",
    foreground: "#eeeeee",
  });

const addedColors = async () => {
  const render = await renderDiff({ full: false, maxLines: 1600, patch });

  const added = render.rows.filter(isLineRow).find((row) => row.type === "add");

  return added?.spans.map((span) => span.fg) ?? [];
};

describe("renderDiff file associations", () => {
  test("renders plain text when a files association turns syntax off", async () => {
    registerFileSupport(
      resolveFileSupportConfig({
        files: { "plain-ts": { extensions: ["ts"], syntax: false } },
      }).registry
    );

    const render = await renderDiff({
      full: false,
      maxLines: 1600,
      patch: patch.replaceAll("foo.ts", "plain.ts"),
    });

    const added = render.rows
      .filter(isLineRow)
      .find((row) => row.type === "add");

    expect(added?.spans.map((span) => span.text).join("")).toBe(
      'const b = "three";'
    );
    expect(new Set(added?.spans.map((span) => span.fg)).size).toBe(1);
  });
});

describe("renderDiff theme attach", () => {
  test("colors a diff under a second built-in theme", async () => {
    setSelection("stet-light");

    const colors = await addedColors();

    expect(new Set(colors).size).toBeGreaterThan(1);
  });

  test("re-colors code when a theme is replaced under the same name", async () => {
    registerSystemTheme(terminal("#00ff00"));
    setSelection("system");
    const before = await addedColors();

    registerSystemTheme(terminal("#ff8800"));
    const after = await addedColors();

    expect(before).toContain("#00ff00");
    expect(after).toContain("#ff8800");
    expect(after).not.toContain("#00ff00");
  });

  test("colors a diff under a bundled theme with that theme's colors", async () => {
    const tokenColors = await addedColors();

    await loadTheme("catppuccin-mocha");
    setSelection("catppuccin-mocha");

    const bundledColors = await addedColors();

    expect(new Set(bundledColors).size).toBeGreaterThan(1);
    expect(bundledColors).not.toEqual(tokenColors);
  });
});

describe("languageForPath", () => {
  test("resolves extensionless filename keys against the basename in any directory", () => {
    expect(languageForPath("Dockerfile")).toBe("dockerfile");
    expect(languageForPath("docker/Dockerfile")).toBe("dockerfile");
    expect(languageForPath("infra/backend/Makefile")).toBe("makefile");
  });

  test("resolves extension-based files, including nested paths", () => {
    expect(languageForPath("src/index.ts")).toBe("typescript");
    expect(languageForPath("nginx.conf")).toBe("nginx");
    expect(languageForPath("templates/view.blade.php")).toBe("blade");
  });

  test("keeps the .gradle Groovy override on the basename", () => {
    expect(languageForPath("app/build.gradle")).toBe("groovy");
  });

  test("peels a .rb.tmpl template to Ruby, leaving other .tmpl files as text", () => {
    expect(languageForPath("script/stet.rb.tmpl")).toBe("ruby");
    expect(languageForPath("script/STET.RB.TMPL")).toBe("ruby");
    expect(languageForPath("a/b/Formula.rb")).toBe("ruby");
    expect(languageForPath("config.yaml.tmpl")).toBe("text");
  });

  test("resolves config dotfiles by name in any directory", () => {
    expect(languageForPath(".env")).toBe("dotenv");
    expect(languageForPath(".ENV")).toBe("dotenv");
    expect(languageForPath("packages/tui/.env")).toBe("dotenv");
    expect(languageForPath(".npmrc")).toBe("ini");
    expect(languageForPath("packages/tui/.npmrc")).toBe("ini");
    expect(languageForPath(".prettierrc")).toBe("jsonc");
  });

  test("leaves a config dotfile's extension variants to the library", () => {
    expect(languageForPath(".prettierrc.json")).toBe("json");
    expect(languageForPath(".prettierrc.yaml")).toBe("yaml");
    expect(languageForPath(".prettierrc.js")).toBe("javascript");
  });

  test("resolves bare dotfiles only by exact name", () => {
    expect(languageForPath(".env.local")).toBe("text");
    expect(languageForPath(".ts")).toBe("text");
    expect(languageForPath(".json")).toBe("text");
    expect(languageForPath(".nvmrc")).toBe("text");
  });
});
