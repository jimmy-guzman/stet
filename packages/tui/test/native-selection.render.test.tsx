import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { rgbToHex, TextRenderable } from "@opentui/core";
import type { Renderable } from "@opentui/core";
import { testRender } from "@opentui/solid";

import { App } from "@/app";
import { state } from "@/state";
import { setAppearance } from "@/theme/active";
import { theme } from "@/theme/context";

import {
  createFixtureRepo,
  loadModel,
  makeSettleUntil,
  recordClipboard,
  seedState,
} from "./helpers";

const scope = { kind: "all", ref: "HEAD" } as const;

const mount = async () => {
  const repoRoot = createFixtureRepo("stet-native-", {
    "notes.md": "note\n",
    "src/a.ts": "base\n",
  });

  writeFileSync(path.join(repoRoot, "src", "a.ts"), "const alpha = 1;\n");
  seedState(await loadModel(repoRoot, scope), scope);

  const copied = recordClipboard();
  const app = await testRender(() => <App />, { height: 56, width: 110 });

  return { ...app, copied, settleUntil: makeSettleUntil(app) };
};

/** The text a drag could select, wherever it is on screen. */
const selectableText = (root: Renderable): string[] => [
  ...(root instanceof TextRenderable && root.selectable
    ? [root.plainText]
    : []),
  ...root.getChildren().flatMap(selectableText),
];

const cellOf = (frame: string, text: string) => {
  const rows = frame.split("\n");
  const y = rows.findIndex((row) => row.includes(text));
  const row = rows[y] ?? "";

  return { x: Bun.stringWidth(row.slice(0, row.indexOf(text))), y };
};

describe("text outside the viewer", () => {
  test("a drag copies it on release, and esc clears the highlight", async () => {
    const { copied, mockInput, mockMouse, renderer, settleUntil } =
      await mount();

    try {
      await settleUntil("loaded", (frame) => frame.includes("alpha"));
      mockInput.pressKey("?");

      const help = await settleUntil("help", (frame) =>
        frame.includes("half-page")
      );

      const { x, y } = cellOf(help, "half-page cursor");
      await mockMouse.drag(x, y, x + 15, y);
      await settleUntil("acknowledged", (frame) =>
        frame.includes("copied 16 characters")
      );
      expect(copied).toEqual(["half-page cursor"]);

      // Across the two columns, the copied text keeps them apart.
      const combo = cellOf(help, "ctrl-d / u");
      await mockMouse.drag(combo.x, combo.y, x + 8, y);
      await settleUntil("columns copied", () => copied.length === 2);
      expect(copied[1]).toBe("ctrl-d / u half-page");

      // A click copies nothing.
      await mockMouse.click(x + 30, y);
      expect(copied).toHaveLength(2);

      await mockMouse.drag(x, y, x + 4, y);
      expect(renderer.hasSelection).toBe(true);
      mockInput.pressEscape();
      await settleUntil("cleared", () => !renderer.hasSelection);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("wears the theme's selection, readable, through a theme change", async () => {
    const { captureSpans, mockMouse, renderer, settleUntil } = await mount();

    const isPainted = (background: string, foreground: string) =>
      captureSpans().lines.some((line) =>
        line.spans.some(
          (span) =>
            span.text.includes("uncommitted") &&
            rgbToHex(span.bg) === background &&
            rgbToHex(span.fg) === foreground
        )
      );

    try {
      const frame = await settleUntil("loaded", (current) =>
        current.includes("alpha")
      );

      const { x, y } = cellOf(frame, "uncommitted");
      await mockMouse.drag(x, y, x + 10, y);

      const dark = theme.colors.selection.bg;
      await settleUntil("painted", () =>
        isPainted(dark, theme.colors.text.primary)
      );

      setAppearance("light");
      expect(theme.colors.selection.bg).not.toBe(dark);
      await settleUntil("repainted", () =>
        isPainted(theme.colors.selection.bg, theme.colors.text.primary)
      );
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("only one selection is highlighted at a time", async () => {
    const { copied, mockMouse, renderer, settleUntil } = await mount();

    try {
      const frame = await settleUntil("loaded", (current) =>
        current.includes("alpha")
      );

      const code = cellOf(frame, "alpha");
      await mockMouse.drag(code.x, code.y, code.x + 4, code.y);
      await settleUntil("viewer copied", () => copied.length === 1);

      const header = cellOf(frame, "uncommitted");
      await mockMouse.drag(header.x, header.y, header.x + 10, header.y);
      await settleUntil("header copied", () => copied.length === 2);
      expect(copied).toEqual(["alpha", "uncommitted"]);
      expect(state.viewerSelection()).toBeUndefined();

      state.extendSelectionRow(1);
      await settleUntil("native cleared", () => !renderer.hasSelection);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("a drag across the viewer's title keeps its parts apart", async () => {
    const { copied, mockMouse, renderer, settleUntil } = await mount();

    try {
      const frame = await settleUntil("loaded", (current) =>
        current.includes("alpha")
      );

      const { content } = state.layout().viewer;
      const title = cellOf(frame, "+1 -1");
      await mockMouse.drag(
        content.x + 1,
        content.y,
        content.x + content.width - 2,
        content.y
      );
      expect(title.y).toBeGreaterThan(-1);
      await settleUntil("copied", () => copied.length === 1);
      expect(copied[0]).toBe("src/a.ts +1 -1");
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("dragging the tree's scrollbar copies nothing", async () => {
    const files = Array.from(
      { length: 80 },
      (_, index) => [`file${index}.md`, "note\n"] as const
    );

    const repoRoot = createFixtureRepo(
      "stet-native-bar-",
      Object.fromEntries(files)
    );

    seedState(await loadModel(repoRoot, scope), scope);
    const copied = recordClipboard();
    const app = await testRender(() => <App />, { height: 30, width: 100 });
    const settleUntil = makeSettleUntil(app);

    try {
      const frame = await settleUntil("overflowing tree", (current) =>
        current.includes("▀")
      );

      const { x, y } = cellOf(frame, "▀");
      await app.mockMouse.drag(x, y, x, y + 4);
      await app.renderOnce();
      expect(copied).toEqual([]);
      expect(app.renderer.hasSelection).toBe(false);
    } finally {
      app.renderer.destroy();
    }
  }, 20_000);

  test("a drag over a tree row opens the file and copies nothing", async () => {
    const { copied, mockMouse, renderer, settleUntil } = await mount();

    try {
      const frame = await settleUntil("loaded", (current) =>
        current.includes("alpha")
      );

      const { x, y } = cellOf(frame, "notes.md");
      await mockMouse.drag(x, y, x + 5, y);
      await settleUntil("opened", () => state.selectedPath() === "notes.md");
      expect(copied).toEqual([]);
      expect(renderer.hasSelection).toBe(false);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  // A press on a row acts at once, so a drag that wobbles off it must not reach the clipboard.
  test("rows that act on a click offer no text to select", async () => {
    const { mockInput, mockMouse, renderer, settleUntil } = await mount();
    const offered = () => selectableText(renderer.root).join("\n");

    try {
      const frame = await settleUntil("loaded", (current) =>
        current.includes("alpha")
      );

      expect(offered()).not.toContain("notes.md");

      const tree = cellOf(frame, "notes.md");
      await mockMouse.click(tree.x, tree.y, 2);
      await settleUntil("tree menu", (current) =>
        current.includes("Copy path")
      );
      expect(offered()).not.toContain("Copy path");
      mockInput.pressEscape();
      await settleUntil("menu closed", () => !state.commandMenuOpen());

      mockInput.pressKey("p", { ctrl: true });
      await settleUntil("file picker", () => state.fileComboboxOpen());
      expect(offered()).not.toContain("notes.md");
      mockInput.pressEscape();
      await settleUntil("file picker closed", () => !state.fileComboboxOpen());

      mockInput.pressKey("t");
      await settleUntil("theme picker", (current) =>
        current.includes("stet-dark")
      );
      expect(offered()).not.toContain("stet-dark");
      mockInput.pressEscape();
      await settleUntil(
        "theme picker closed",
        () => !state.themeComboboxOpen()
      );

      mockInput.pressKey("s");
      await settleUntil("scope menu", (current) => current.includes("session"));
      expect(offered()).not.toContain("session");
      mockInput.pressEscape();
      await settleUntil("scope menu closed", () => !state.scopeMenuOpen());

      mockInput.pressKey("f", { ctrl: true });
      await settleUntil("search", (current) => current.includes("search…"));
      await mockInput.typeText("alpha");
      await settleUntil("results", (current) =>
        current.includes("1 match in 1 file")
      );
      expect(offered()).not.toContain("const alpha = 1;");
      expect(offered()).not.toContain("src/a.ts");
    } finally {
      renderer.destroy();
    }
  }, 20_000);
});
