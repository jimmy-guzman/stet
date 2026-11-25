import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { MouseButton, RGBA } from "@opentui/core";
import { createMockMouse } from "@opentui/core/testing";
import { testRender } from "@opentui/solid";

import { App } from "@/app";
import { state } from "@/state";
import { theme } from "@/theme/context";

import {
  createFixtureRepo,
  cursorLineContent,
  loadModel,
  makeSettleUntil,
  recordClipboard,
  seedState,
} from "./helpers";

// One committed line plus two appended lines, so the whole small file shows in the
// Diff (one context row + two adds) with clean per-line content and stable navIndices
// 0/1/2 — no remove rows to interleave.
const snippetRepo = (prefix: string) => {
  const repoRoot = createFixtureRepo(prefix, {
    "package.json": `${JSON.stringify({ scripts: { lint: "exit 0", typecheck: "exit 0" } })}\n`,
    "src/snippet.ts": "alpha\n",
  });

  writeFileSync(
    path.join(repoRoot, "src", "snippet.ts"),
    "alpha\nbeta\ngamma\n"
  );

  return repoRoot;
};

const longSnippetRepo = (prefix: string) => {
  const repoRoot = createFixtureRepo(prefix, {
    "package.json": `${JSON.stringify({ scripts: { lint: "exit 0", typecheck: "exit 0" } })}\n`,
    "src/snippet.ts": "// base\n",
  });

  const additions = Array.from(
    { length: 40 },
    (_, index) => `// line-${String(index + 1).padStart(2, "0")}`
  );

  writeFileSync(
    path.join(repoRoot, "src", "snippet.ts"),
    ["// base", ...additions, ""].join("\n")
  );

  return repoRoot;
};

/** The navIndex span of the selection, for the tests about which lines it covers. */
const selectedLines = () => {
  const range = state.selectionRange();

  return range === undefined ? undefined : [range.start.index, range.end.index];
};

const scope = { kind: "all", ref: "HEAD" } as const;

/** One file open in the viewer, and the screen cell of any text in it. */
const mountFile = async (after: string, width = 110) => {
  const repoRoot = createFixtureRepo("stet-select-", { "src/a.ts": "base\n" });
  writeFileSync(path.join(repoRoot, "src", "a.ts"), after);
  seedState(await loadModel(repoRoot, scope), scope);

  const copied = recordClipboard();
  const app = await testRender(() => <App />, { height: 24, width });

  const cellOf = (text: string) => {
    const rows = app.captureCharFrame().split("\n");
    const y = rows.findIndex((row) => row.includes(text));
    const row = rows[y] ?? "";

    return { x: Bun.stringWidth(row.slice(0, row.indexOf(text))), y };
  };

  return { ...app, cellOf, copied, settleUntil: makeSettleUntil(app) };
};

type Mounted = Awaited<ReturnType<typeof mountFile>>;

const dragText = async (
  { cellOf, mockMouse }: Mounted,
  from: { text: string; offset?: number },
  to: { text: string; offset?: number }
) => {
  const start = cellOf(from.text);
  const end = cellOf(to.text);
  await mockMouse.drag(
    start.x + (from.offset ?? 0),
    start.y,
    end.x + (to.offset ?? 0),
    end.y
  );
};

describe("mouse selection", () => {
  test("a drag copies the exact characters it covers, once, on release", async () => {
    const app = await mountFile("const total = sum(rows);\nreturn total;\n");
    const { cellOf, copied, mockMouse, renderer, settleUntil } = app;

    try {
      await settleUntil("loaded", (frame) => frame.includes("sum(rows)"));
      const start = cellOf("total = sum");
      const end = cellOf("rows);");

      await mockMouse.pressDown(start.x, start.y);
      await mockMouse.moveTo(end.x + 4, end.y);
      expect(copied).toEqual([]);
      await mockMouse.release(end.x + 4, end.y);
      await settleUntil("acknowledged", (frame) =>
        frame.includes("copied 17 characters")
      );
      expect(copied).toEqual(["total = sum(rows)"]);

      // Backwards, and across lines, the same glyphs are covered.
      await dragText(
        app,
        { offset: 5, text: "return total" },
        { text: "rows);" }
      );
      await settleUntil("second copy", () => copied.length === 2);
      expect(copied[1]).toBe("rows);\nreturn");
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("selected text is marked on its own columns, and the caret line keeps its gutter lift", async () => {
    const app = await mountFile("top();\nconst total = 1;\nreturn total;\n");
    const { captureSpans, copied, renderer, settleUntil } = app;

    const backgroundOf = (text: string) =>
      captureSpans()
        .lines.flatMap(({ spans }) => spans)
        .find((span) => span.text.includes(text))
        ?.bg.toInts();

    try {
      await settleUntil("loaded", (frame) => frame.includes("return"));
      const unselected = backgroundOf("return");
      await dragText(app, { text: "total = " }, { offset: 4, text: "total" });
      await settleUntil("selected", () => copied.length === 1);

      expect(backgroundOf("total")).toEqual(
        RGBA.fromHex(theme.colors.selection.bg).toInts()
      );
      // Both lines are added lines, so the rest of the selected one reads like the other.
      expect(backgroundOf("const")).toEqual(unselected);

      const gutter = captureSpans().lines.find(({ spans }) =>
        spans.some((span) => span.text.includes("const"))
      );

      expect(
        gutter?.spans.find((span) => span.text.includes("▎"))?.bg.toInts()
      ).not.toEqual(unselected);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("a click selects and copies nothing, and clears a selection", async () => {
    const app = await mountFile("const total = 1;\n");
    const { cellOf, copied, mockMouse, renderer, settleUntil } = app;

    try {
      await settleUntil("loaded", (frame) => frame.includes("const total"));
      await dragText(app, { text: "const" }, { offset: 4, text: "const" });
      await settleUntil("selected", () => state.selectionRange() !== undefined);

      const { x, y } = cellOf("total");
      await mockMouse.click(x + 20, y);
      await settleUntil("cleared", () => state.selectionRange() === undefined);
      expect(copied).toEqual(["const"]);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("a double-click copies the word and a triple-click the line", async () => {
    const app = await mountFile("  const total = sum(rows);\n");
    const { cellOf, copied, mockMouse, renderer, settleUntil } = app;

    try {
      await settleUntil("loaded", (frame) => frame.includes("sum(rows)"));
      const { x, y } = cellOf("total");
      await mockMouse.click(x + 2, y);
      await mockMouse.click(x + 2, y);
      await settleUntil("word copied", () => copied.length === 1);
      await mockMouse.click(x + 2, y);
      await settleUntil("line copied", (frame) =>
        frame.includes("copied 1 line")
      );
      expect(copied).toEqual(["total", "  const total = sum(rows);"]);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("a drag after a double-click extends by whole words", async () => {
    const app = await mountFile("const total = sum(rows);\n");
    const { cellOf, copied, mockMouse, renderer, settleUntil } = app;

    try {
      await settleUntil("loaded", (frame) => frame.includes("sum(rows)"));
      const { x, y } = cellOf("total");
      const rows = cellOf("rows);");
      await mockMouse.click(x + 2, y);
      await mockMouse.pressDown(x + 2, y);
      await mockMouse.moveTo(rows.x + 1, rows.y);
      await mockMouse.release(rows.x + 1, rows.y);
      await settleUntil("copied", () => copied.length === 1);
      expect(copied).toEqual(["total = sum(rows"]);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("a gutter drag copies whole lines", async () => {
    const app = await mountFile("alpha();\n\n  beta();\ngamma();\n");
    const { cellOf, copied, mockMouse, renderer, settleUntil } = app;

    try {
      await settleUntil("loaded", (frame) => frame.includes("gamma"));
      const { x } = state.layout().viewer.content;
      await mockMouse.drag(x, cellOf("alpha").y, x, cellOf("beta").y);
      await settleUntil("copied", (frame) => frame.includes("copied 3 lines"));
      expect(copied).toEqual(["alpha();\n\n  beta();"]);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("tabs and clusters map a drag to the glyphs under it", async () => {
    const app = await mountFile("\t\tcall\t(a);\nconst 👍🏽 = 日本;\n");
    const { copied, renderer, settleUntil } = app;

    try {
      await settleUntil("loaded", (frame) => frame.includes("日本"));
      await dragText(app, { text: "call" }, { offset: 1, text: "(a);" });
      await settleUntil("tabbed copy", () => copied.length === 1);
      await dragText(app, { text: "👍🏽" }, { text: "本" });
      await settleUntil("wide copy", () => copied.length === 2);
      expect(copied).toEqual(["call\t(a", "👍🏽 = 日本"]);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("a wrapped line copies its source text with no break", async () => {
    const line = Array.from({ length: 30 }, (_, index) => `word${index}`).join(
      " "
    );

    const app = await mountFile(`${line}\n`, 80);
    const { copied, mockInput, renderer, settleUntil } = app;

    try {
      await settleUntil("loaded", (frame) => frame.includes("word0"));
      mockInput.pressKey("x");
      await settleUntil("wrapped", (frame) => frame.includes("word29"));
      await dragText(app, { text: "word2 " }, { offset: 5, text: "word25" });
      await settleUntil("copied", () => copied.length === 1);
      expect(copied[0]).toBe(
        line.slice(line.indexOf("word2 "), line.indexOf("word26") - 1)
      );
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("a drag follows a line scrolled sideways, and scrolls it at the edge", async () => {
    const line = Array.from({ length: 60 }, (_, index) => `item${index}`).join(
      " "
    );

    const app = await mountFile(`${line}\n`);
    const { cellOf, copied, mockMouse, renderer, settleUntil } = app;

    try {
      await settleUntil("loaded", (frame) => frame.includes("item0"));
      state.setViewerScrollX(100);
      await settleUntil("scrolled", (frame) => frame.includes("item20"));
      await dragText(app, { text: "item18" }, { offset: 5, text: "item20" });
      await settleUntil("copied", () => copied.length === 1);
      expect(copied[0]).toBe("item18 item19 item20");

      const start = cellOf("item18");
      const { content } = state.layout().viewer;
      const edge = content.x + content.width - 1;
      await mockMouse.pressDown(start.x, start.y);
      await mockMouse.moveTo(edge, start.y);
      await settleUntil("scrolls on", () => state.viewerScrollX() > 140);
      await mockMouse.release(edge, start.y);
      const released = state.viewerScrollX();
      await Bun.sleep(130);
      expect(state.viewerScrollX()).toBe(released);
      expect(copied[1]?.startsWith("item18 item19")).toBe(true);
      expect(copied[1]?.length).toBeGreaterThan(content.width);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("a drag along the first or last visible row selects that row", async () => {
    const body = Array.from(
      { length: 100 },
      (_, index) => `line${index} tail();`
    ).join("\n");

    const app = await mountFile(`${body}\n`);
    const { cellOf, copied, mockMouse, renderer, settleUntil } = app;

    // Slow enough that an edge timer would fire several times on the way.
    const dragSlowly = async (text: string) => {
      const { x, y } = cellOf(text);
      await mockMouse.pressDown(x, y);

      for (const step of [1, 2, 3, 4, 5]) {
        // oxlint-disable-next-line no-await-in-loop -- one pointer report per cell, in order
        await Bun.sleep(40);
        // oxlint-disable-next-line no-await-in-loop -- one pointer report per cell, in order
        await mockMouse.moveTo(x + step, y);
      }

      await mockMouse.release(x + 5, y);
    };

    try {
      await settleUntil("loaded", (frame) => frame.includes("line0 tail"));
      state.setViewerScrollTop(30);

      const visible = await settleUntil("scrolled", (frame) =>
        frame.includes("line45 tail")
      );

      const shown = [...visible.matchAll(/line(?<row>\d+) tail/gu)].map(
        (match) => match[0].replace(" tail", "")
      );

      await dragSlowly(shown.at(0) ?? "");
      await settleUntil("top copied", () => copied.length === 1);
      await dragSlowly(shown.at(-1) ?? "");
      await settleUntil("bottom copied", () => copied.length === 2);

      expect(copied).toEqual([shown.at(0) ?? "", shown.at(-1) ?? ""]);
      expect(state.viewerScrollTop()).toBe(30);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("a drag released on a gap marker stops at its own side", async () => {
    const rows = Array.from({ length: 60 }, (_, index) => `row${index + 1}`);

    const repoRoot = createFixtureRepo("stet-select-gap-", {
      "src/a.ts": `${rows.join("\n")}\n`,
    });

    writeFileSync(
      path.join(repoRoot, "src", "a.ts"),
      `${rows.with(9, "changed10").with(49, "changed50").join("\n")}\n`
    );
    seedState(await loadModel(repoRoot, scope), scope);
    const copied = recordClipboard();
    const app = await testRender(() => <App />, { height: 30, width: 100 });
    const settleUntil = makeSettleUntil(app);

    try {
      const frame = await settleUntil("gap shown", (current) =>
        current.includes("33 unmodified lines")
      );

      const lines = frame.split("\n");

      const at = (text: string) => ({
        x: lines.find((line) => line.includes(text))?.indexOf(text) ?? -1,
        y: lines.findIndex((line) => line.includes(text)),
      });

      const marker = at("33 unmodified");
      const below = at("row48");
      await app.mockMouse.drag(below.x + 2, below.y, below.x, marker.y);
      await settleUntil("up copied", () => copied.length === 1);
      expect(copied[0]).toBe("row47\nrow");
      expect(state.referenceLines()).toEqual({ endLine: 48, line: 47 });

      const above = at("row12");
      await app.mockMouse.drag(above.x, above.y, above.x, marker.y);
      await settleUntil("down copied", () => copied.length === 2);
      expect(copied[1]).toBe("row12\nrow13");
    } finally {
      app.renderer.destroy();
    }
  }, 20_000);

  test("a click below the file clears the selection", async () => {
    const app = await mountFile("alpha();\n");
    const { cellOf, copied, mockMouse, renderer, settleUntil } = app;

    try {
      await settleUntil("loaded", (frame) => frame.includes("alpha"));
      await dragText(app, { text: "alpha" }, { offset: 4, text: "alpha" });
      await settleUntil("selected", () => copied.length === 1);
      const { x, y } = cellOf("alpha");
      await mockMouse.click(x, y + 8);
      await settleUntil("cleared", () => state.selectionRange() === undefined);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("a fourth click keeps the line, and a middle drag selects nothing", async () => {
    const app = await mountFile("alpha beta\n");
    const { cellOf, copied, mockMouse, renderer, settleUntil } = app;

    try {
      await settleUntil("loaded", (frame) => frame.includes("alpha"));
      const { x, y } = cellOf("alpha");
      await mockMouse.drag(x, y, x + 4, y, MouseButton.MIDDLE);
      expect(copied).toEqual([]);
      expect(state.selectionRange()).toBeUndefined();

      await mockMouse.click(x, y);
      await mockMouse.click(x, y);
      await mockMouse.click(x, y);
      await mockMouse.click(x, y);
      expect(state.viewerSelection()?.unit).toBe("line");
      await settleUntil("copied", () => copied.length === 3);
      expect(copied).toEqual(["alpha", "alpha beta", "alpha beta"]);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("a right-click beside the selected text on its own line drops it", async () => {
    const app = await mountFile("const total = sum(rows);\n");
    const { cellOf, copied, mockMouse, renderer, settleUntil } = app;

    try {
      await settleUntil("loaded", (frame) => frame.includes("total"));
      await dragText(app, { text: "total" }, { offset: 4, text: "total" });
      await settleUntil("selected", () => copied.length === 1);
      const rows = cellOf("rows);");
      await mockMouse.click(rows.x, rows.y, MouseButton.RIGHT);

      const menu = await settleUntil("menu", (frame) =>
        frame.includes("Copy reference")
      );

      expect(menu).not.toContain("Copy selection");
      expect(state.selectionRange()).toBeUndefined();
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  // Each target, and the cells OpenTUI paints before it.
  test.each([
    ["an escape", "\u001B[31mred\u001B[0m target", 11],
    ["a soft hyphen", "soft\u00ADhyphen target", 12],
    ["a vowel sign", "काका target", 5],
  ])(
    "%s before a drag leaves it on the glyphs under it",
    async (_, line, cells) => {
      const app = await mountFile(`${line}\n`);

      const { captureSpans, cellOf, copied, renderer, settleUntil } = app;

      const marked = () =>
        captureSpans()
          .lines.flatMap(({ spans }) => spans)
          .filter((span) =>
            span.bg.equals(RGBA.fromHex(theme.colors.selection.bg))
          )
          .map((span) => span.text)
          .join("");

      try {
        await settleUntil("loaded", (frame) => frame.includes("target"));
        const x = state.layout().viewer.content.x + 3 + cells;
        const { y } = cellOf("target");
        await app.mockMouse.drag(x, y, x + "target".length - 1, y);
        await settleUntil("copied", () => copied.length === 1);
        expect(copied).toEqual(["target"]);
        expect(marked()).toBe("target");
      } finally {
        renderer.destroy();
      }
    },
    20_000
  );

  test("a right-click inside a selection keeps it, and elsewhere drops it", async () => {
    const app = await mountFile("alpha();\nbeta();\ngamma();\n");
    const { cellOf, copied, mockInput, mockMouse, renderer, settleUntil } = app;

    try {
      await settleUntil("loaded", (frame) => frame.includes("gamma"));
      await dragText(app, { text: "alpha" }, { offset: 3, text: "beta" });
      await settleUntil("selected", () => copied.length === 1);

      const inside = cellOf("beta");
      await mockMouse.click(inside.x, inside.y, MouseButton.RIGHT);
      await settleUntil("menu offers the selection", (frame) =>
        frame.includes("Copy selection")
      );
      mockInput.pressEnter();
      await settleUntil("copied from the menu", () => copied.length === 2);
      expect(copied).toEqual(["alpha();\nbeta", "alpha();\nbeta"]);

      const outside = cellOf("gamma");
      await mockMouse.click(outside.x, outside.y, MouseButton.RIGHT);
      await settleUntil("menu without a selection", (frame) =>
        frame.includes("Copy reference")
      );
      expect(state.selectionRange()).toBeUndefined();
      expect(state.cursorLineNumber()).toBe(3);

      // A press on the caret's own line moves nothing, and still dismisses the menu.
      await mockMouse.click(outside.x + 30, outside.y);
      await settleUntil("menu closed", () => !state.commandMenuOpen());
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  // Past a line's text there is nothing selected to be on; a blank line is all the selection has.
  test.each([
    ["a blank line keeps", 1, 0, [1, 3]],
    ["the space past a line's text drops", 0, 30, undefined],
  ])(
    "a right-click on %s the selection",
    async (_, down, right, kept) => {
      const app = await mountFile("alpha();\n\ngamma();\n");
      const { cellOf, copied, mockMouse, renderer, settleUntil } = app;

      try {
        await settleUntil("loaded", (frame) => frame.includes("gamma"));
        await dragText(app, { text: "alpha" }, { offset: 4, text: "gamma" });
        await settleUntil("selected", () => copied.length === 1);
        const { x, y } = cellOf("alpha");
        await mockMouse.click(x + right, y + down, MouseButton.RIGHT);
        await settleUntil("menu", (frame) => frame.includes("Copy reference"));
        expect(selectedLines()).toEqual(kept);
      } finally {
        renderer.destroy();
      }
    },
    20_000
  );

  test.each([
    ["past the text of", 0],
    ["on a blank one of", 1],
  ])(
    "a right-click %s the selected lines keeps them",
    async (_, down) => {
      const app = await mountFile("alpha();\n\ngamma();\n");
      const { cellOf, mockInput, mockMouse, renderer, settleUntil } = app;

      try {
        await settleUntil("loaded", (frame) => frame.includes("gamma"));
        const { x, y } = cellOf("alpha");
        await mockMouse.click(x, y);
        mockInput.pressArrow("down", { shift: true });
        await settleUntil("two lines", () => selectedLines()?.[1] === 2);
        await mockMouse.click(x + 30, y + down, MouseButton.RIGHT);
        await settleUntil("menu offers the selection", (frame) =>
          frame.includes("Copy selection")
        );
        expect(selectedLines()).toEqual([1, 2]);
      } finally {
        renderer.destroy();
      }
    },
    20_000
  );

  test.each([
    ["first", 0],
    ["last", -1],
  ])(
    "a right-click on the %s visible row opens the menu",
    async (_, edge) => {
      const body = Array.from(
        { length: 100 },
        (_line, index) => `line${index} tail();`
      ).join("\n");

      const app = await mountFile(`${body}\n`);
      const { cellOf, mockMouse, renderer, settleUntil } = app;

      try {
        await settleUntil("loaded", (frame) => frame.includes("line0 tail"));
        state.setViewerScrollTop(30);

        const visible = await settleUntil("scrolled", (frame) =>
          frame.includes("line40 tail")
        );

        const shown = [...visible.matchAll(/line\d+ tail/gu)].at(edge)?.[0];
        const { x, y } = cellOf(shown ?? "");
        await mockMouse.click(x, y, MouseButton.RIGHT);
        await settleUntil("menu open", (frame) =>
          frame.includes("Copy reference")
        );
      } finally {
        renderer.destroy();
      }
    },
    20_000
  );

  test("shift-click extends from the cursor, and from a selection", async () => {
    const app = await mountFile("alpha();\nbeta();\ngamma();\n");
    const { cellOf, copied, mockMouse, renderer, settleUntil } = app;

    try {
      await settleUntil("loaded", (frame) => frame.includes("gamma"));
      const alpha = cellOf("alpha");
      const beta = cellOf("beta");
      const gamma = cellOf("gamma");
      await mockMouse.click(alpha.x, alpha.y);
      await mockMouse.click(beta.x, beta.y, 0, { modifiers: { shift: true } });
      await settleUntil("lines", () => copied.length === 1);
      await mockMouse.click(gamma.x, gamma.y, 0, {
        modifiers: { shift: true },
      });
      await settleUntil("more lines", () => copied.length === 2);
      expect(copied).toEqual([
        "alpha();\nbeta();",
        "alpha();\nbeta();\ngamma();",
      ]);
    } finally {
      renderer.destroy();
    }
  }, 20_000);
});

describe("keyboard selection", () => {
  test("Shift+arrows select lines; y copies their range and Y their text", async () => {
    const repoRoot = snippetRepo("stet-copy-sel-");
    const model = await loadModel(repoRoot, scope);
    seedState(model, scope);
    const copied = recordClipboard();

    const { renderer, renderOnce, captureCharFrame, mockInput } =
      await testRender(() => <App />, {
        height: 30,
        width: 110,
      });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil(
        "diff shown",
        (frame) => frame.includes("beta") && frame.includes("gamma")
      );
      mockInput.pressTab();
      mockInput.pressKey("g");
      await settleUntil(
        "caret at the top line",
        () => state.cursorIndex() === 0
      );
      mockInput.pressKey("y");

      mockInput.pressArrow("down", { shift: true });
      mockInput.pressArrow("down", { shift: true });
      await settleUntil(
        "selection spans three lines",
        () => String(selectedLines()) === "0,2"
      );
      mockInput.pressKey("y");
      mockInput.pressKey("Y");
      await settleUntil("all copied", () => copied.length === 3);
      expect(copied).toEqual([
        "src/snippet.ts:1",
        "src/snippet.ts:1-3",
        "alpha\nbeta\ngamma",
      ]);

      // A plain vertical move drops the selection, so Y goes back to the whole file.
      mockInput.pressKey("k");
      await settleUntil(
        "selection cleared",
        () => state.selectionRange() === undefined
      );
      mockInput.pressKey("Y");
      await settleUntil("file copied", () => copied.length === 4);
      expect(copied[3]).toBe("alpha\nbeta\ngamma");
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("Shift+arrows adjust a dragged selection, keeping its characters", async () => {
    const app = await mountFile("alpha();\nbeta();\n");
    const { copied, mockInput, renderer, settleUntil } = app;

    const copyNow = async () => {
      const before = copied.length;
      mockInput.pressKey("Y");
      await settleUntil("copied", () => copied.length > before);

      return copied.at(-1);
    };

    try {
      await settleUntil("loaded", (frame) => frame.includes("beta"));
      await dragText(app, { text: "alpha" }, { offset: 3, text: "alpha" });
      await settleUntil("dragged", () => copied.length === 1);
      expect(copied[0]).toBe("alph");

      mockInput.pressArrow("right", { shift: true });
      expect(await copyNow()).toBe("alpha");
      mockInput.pressArrow("left", { shift: true });
      mockInput.pressArrow("left", { shift: true });
      expect(await copyNow()).toBe("alp");
      mockInput.pressArrow("down", { shift: true });
      expect(await copyNow()).toBe("alpha();\nbet");
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("a held edge auto-scrolls the drag selection and stops on move or release", async () => {
    const repoRoot = longSnippetRepo("stet-copy-sel-edge-");
    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });

    const { renderer, renderOnce, captureCharFrame } = await testRender(
      () => <App />,
      {
        height: 18,
        width: 110,
      }
    );

    const copied = recordClipboard();
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });
    const mouse = createMockMouse(renderer);

    try {
      const frame = await settleUntil(
        "long diff shown",
        (current) => current.includes("base") && current.includes("line-01")
      );

      const frameRows = frame.split("\n");
      const baseRow = frameRows.findIndex((row) => row.includes("base"));
      expect(baseRow).toBeGreaterThan(0);
      const viewerTop = baseRow;
      const viewerBottom = viewerTop + state.viewerHeight();
      const contentX = state.layout().viewer.x + 8;

      await mouse.pressDown(contentX, baseRow);
      await mouse.moveTo(contentX, viewerBottom);
      await settleUntil(
        "held bottom edge advances without more pointer motion",
        () => {
          const range = state.selectionRange();

          return (
            state.viewerScrollTop() >= 4 &&
            range !== undefined &&
            range.end.index > 8
          );
        }
      );

      // One cell inside the viewport cancels the timer while the drag stays held.
      await mouse.moveTo(contentX, viewerBottom - 1);
      await Bun.sleep(20);
      const stoppedInside = state.viewerScrollTop();
      await Bun.sleep(130);
      await renderOnce();
      expect(state.viewerScrollTop()).toBe(stoppedInside);

      // Reversing to the top edge restarts the timer. Release while it is still
      // Moving and before it reaches the boundary, then prove no later tick lands.
      await mouse.moveTo(contentX, viewerTop - 1);
      await settleUntil(
        "held top edge restarts auto-scroll",
        () =>
          state.viewerScrollTop() < stoppedInside && state.viewerScrollTop() > 0
      );
      await mouse.release(contentX, viewerTop - 1);
      const releasedAt = state.viewerScrollTop();
      expect(releasedAt).toBeGreaterThan(0);
      await Bun.sleep(130);
      await renderOnce();
      expect(state.viewerScrollTop()).toBe(releasedAt);
      expect(copied).toHaveLength(1);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("a selection survives a fold toggle (anchor remaps like the caret)", async () => {
    const source = [
      "export const before = 0",
      "export function foo() {",
      "  const a = 1",
      "  const b = 2",
      "}",
      "export const after = 5",
    ].join("\n");

    const repoRoot = createFixtureRepo("stet-sel-fold-", {
      "package.json": `${JSON.stringify({ scripts: { lint: "exit 0", typecheck: "exit 0" } })}\n`,
      "src/mod.ts": `${source}\n`,
    });

    // A trivial edit makes it a changed file so it auto-opens in the viewer.
    writeFileSync(
      path.join(repoRoot, "src", "mod.ts"),
      `${source.replace("const a = 1", "const a = 9")}\n`
    );

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });

    const { renderer, renderOnce, captureCharFrame, mockInput } =
      await testRender(() => <App />, {
        height: 30,
        width: 110,
      });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil(
        "diff shown",
        (f) => f.includes("const a = 9") && f.includes("const b = 2")
      );
      mockInput.pressTab();
      // Full-file view so each line is a single navigable row (a diff would split the
      // Edited line into a remove + add row and shift the indices under test).
      mockInput.pressKey("v");
      await settleUntil(
        "file view",
        (f) => f.includes("const a = 9") && !f.includes("const a = 1")
      );

      // Anchor below the block (on "after"), then extend up so the caret lands inside
      // Foo's body. Folding then hides the caret line, which re-homes to the fold
      // Header, and shifts the anchor up, so both endpoints must remap, not just one.
      mockInput.pressKey("G");
      await settleUntil("caret on the last line", () =>
        cursorLineContent().includes("after")
      );
      mockInput.pressArrow("up", { shift: true });
      mockInput.pressArrow("up", { shift: true });
      mockInput.pressArrow("up", { shift: true });
      await settleUntil("caret inside foo, anchor on after", () => {
        const range = state.selectionRange();

        return (
          cursorLineContent().includes("const a = 9") && range?.end.index === 5
        );
      });
      expect(selectedLines()).toEqual([2, 5]);

      // Fold the block at the caret: its body collapses (proving the fold ran). The
      // Caret re-homes to the fold header (index 1) and the anchor shifts up (5 -> 3),
      // So the full tuple must be [1, 3]; without the anchor remap it would clear.
      mockInput.pressKey("z");

      const folded = await settleUntil(
        "block folded and both endpoints remapped",
        (frame) => {
          const range = state.selectionRange();

          return (
            !frame.includes("const b = 2") &&
            range !== undefined &&
            range.start.index === 1 &&
            range.end.index === 3
          );
        }
      );

      expect(folded).not.toContain("const b = 2");
      expect(selectedLines()).toEqual([1, 3]);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("a scope change clears the selection (content identity drifts)", async () => {
    const repoRoot = snippetRepo("stet-sel-scope-");
    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });

    const { renderer, renderOnce, captureCharFrame, mockInput } =
      await testRender(() => <App />, {
        height: 30,
        width: 110,
      });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil(
        "diff shown",
        (f) => f.includes("beta") && f.includes("gamma")
      );
      mockInput.pressTab();
      mockInput.pressKey("g");
      mockInput.pressArrow("down", { shift: true });
      mockInput.pressArrow("down", { shift: true });
      await settleUntil(
        "selection built",
        () => state.selectionRange() !== undefined
      );

      // Switching scope reloads the diff against a different line list, so a navIndex
      // Anchor is meaningless; the identity-drift effect must drop it even though this
      // Path never routes through the caret/goToLocation clears.
      state.selectScope("session");
      await settleUntil(
        "selection cleared on scope change",
        () =>
          state.selectionRange() === undefined &&
          state.viewerSelection() === undefined
      );
      expect(state.selectionRange()).toBeUndefined();
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("esc closes the find bar before it clears the selection", async () => {
    const repoRoot = snippetRepo("stet-sel-find-esc-");
    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });

    const { renderer, renderOnce, captureCharFrame, mockInput } =
      await testRender(() => <App />, {
        height: 30,
        width: 110,
      });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil(
        "diff shown",
        (f) => f.includes("beta") && f.includes("gamma")
      );
      mockInput.pressTab();
      mockInput.pressKey("g");
      mockInput.pressArrow("down", { shift: true });
      mockInput.pressArrow("down", { shift: true });
      await settleUntil(
        "selection built",
        () => state.selectionRange() !== undefined
      );

      // Opening the find bar moves no caret, so the selection persists alongside it.
      mockInput.pressKey("/");
      await settleUntil("find bar open", () => state.findOpen());
      expect(state.selectionRange()).not.toBeUndefined();

      // First esc dismisses the find bar (the more recent modal), not the selection.
      mockInput.pressEscape();
      await settleUntil("find closed, selection kept", () => !state.findOpen());
      expect(state.selectionRange()).not.toBeUndefined();

      // A second esc then clears the selection.
      mockInput.pressEscape();
      await settleUntil(
        "selection cleared",
        () => state.selectionRange() === undefined
      );
    } finally {
      renderer.destroy();
    }
  }, 20_000);
});
