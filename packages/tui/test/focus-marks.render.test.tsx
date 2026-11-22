import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";

import { App } from "@/app";
import { emptyTreeForFormat } from "@/git/repo";
import { state } from "@/state";
import { theme } from "@/theme/context";

import {
  createFixtureRepo,
  loadModel,
  makeSettleUntil,
  seedState,
} from "./helpers";

const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

const sameColor = (a: RGBA, b: RGBA) =>
  near(a.r, b.r) && near(a.g, b.g) && near(a.b, b.b) && near(a.a, b.a);

interface Frame {
  lines: { spans: { text: string; fg: RGBA; bg: RGBA }[] }[];
}

const spanWith = (frame: Frame, text: string) =>
  frame.lines
    .flatMap((line) => line.spans)
    .find((span) => span.text.includes(text));

// Whether some cell inside [left, right) carries the background. Spans carry no column, so each
// Line's spans are walked and their widths summed.
const hasBackgroundIn = (frame: Frame, bg: RGBA, left: number, right: number) =>
  frame.lines.some((line) => {
    let x = 0;

    for (const span of line.spans) {
      if (x >= left && x < right && sameColor(span.bg, bg)) {
        return true;
      }

      x += Bun.stringWidth(span.text);
    }

    return false;
  });

// Neither pane has a frame, so each pane's own highlight is its focus mark: no two panes may show
// One at the same time, and a viewer with no caret line still needs one.
describe("focus marks", () => {
  test("the viewer's file name is brightest only while the viewer is focused", async () => {
    const repoRoot = createFixtureRepo("stet-focus-title-", {
      "src/a.ts": "const a = 1\n",
    });

    writeFileSync(path.join(repoRoot, "src", "a.ts"), "const a = 2\n");

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });

    const { renderer, renderOnce, captureCharFrame, captureSpans, mockInput } =
      await testRender(() => <App />, { height: 16, width: 100 });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });
    const titleFg = () => spanWith(captureSpans(), "src/a.ts")?.fg;

    try {
      await settleUntil("title shown", (frame) => frame.includes("src/a.ts"));
      expect(state.focusedPane()).toBe("tree");
      expect(
        sameColor(
          titleFg() ?? RGBA.fromHex("#000"),
          RGBA.fromHex(theme.colors.text.secondary)
        )
      ).toBe(true);

      mockInput.pressTab();
      await settleUntil("viewer focused", () => state.focusedPane() === "diff");
      await renderOnce();
      expect(
        sameColor(
          titleFg() ?? RGBA.fromHex("#000"),
          RGBA.fromHex(theme.colors.text.primary)
        )
      ).toBe(true);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("an empty pane marks focus on its empty-state line", async () => {
    // A repository with no files and no commits: the tree has no rows and nothing is selected.
    const repoRoot = createFixtureRepo(
      "stet-focus-empty-",
      {},
      { commit: false }
    );

    const scope = { kind: "all", ref: emptyTreeForFormat("sha1") } as const;
    seedState(await loadModel(repoRoot, scope), scope);

    const { renderer, renderOnce, captureCharFrame, captureSpans, mockInput } =
      await testRender(() => <App />, { height: 16, width: 100 });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    const fgOf = (text: string) =>
      spanWith(captureSpans(), text)?.fg ?? RGBA.fromHex("#000");

    const primary = RGBA.fromHex(theme.colors.text.primary);
    const muted = RGBA.fromHex(theme.colors.text.muted);

    try {
      await settleUntil(
        "both empty states",
        (frame) =>
          frame.includes("no files") && frame.includes("nothing to inspect")
      );
      expect(state.focusedPane()).toBe("tree");
      expect(sameColor(fgOf("no files"), primary)).toBe(true);
      expect(sameColor(fgOf("nothing to inspect"), muted)).toBe(true);

      mockInput.pressTab();
      await settleUntil("viewer focused", () => state.focusedPane() === "diff");
      await renderOnce();
      expect(sameColor(fgOf("no files"), muted)).toBe(true);
      expect(sameColor(fgOf("nothing to inspect"), primary)).toBe(true);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("a search result stays lit only while the search view is focused", async () => {
    const repoRoot = createFixtureRepo("stet-focus-search-", {
      "src/a.ts": "const x = 1\n",
    });

    writeFileSync(
      path.join(repoRoot, "src", "a.ts"),
      "const x = 1\nconst needle = 2\n"
    );

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });

    const { renderer, renderOnce, captureCharFrame, captureSpans, mockInput } =
      await testRender(() => <App />, { height: 20, width: 100 });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    // The selected row is lit with the cursor surface, or the active match background on a match line.
    const lit = [
      RGBA.fromHex(theme.colors.surface.cursor),
      theme.rgba.findMatchBgActive,
    ];

    // Only cells inside the viewer count: the tree lights its own cursor row once it takes focus.
    const resultLit = () =>
      captureSpans().lines.some((line) => {
        let x = 0;

        for (const span of line.spans) {
          if (
            x >= state.layout().viewer.x &&
            lit.some((bg) => sameColor(span.bg, bg))
          ) {
            return true;
          }

          x += Bun.stringWidth(span.text);
        }

        return false;
      });

    try {
      await settleUntil("app chrome", (frame) => frame.includes("q quit"));
      mockInput.pressKey("f", { ctrl: true });
      await settleUntil("search pane", (frame) => frame.includes("search…"));
      await mockInput.typeText("needle");
      await settleUntil("results", (frame) =>
        frame.includes("1 match in 1 file")
      );
      expect(state.focusedPane()).toBe("search");
      await settleUntil("selected result lit", resultLit);

      // The selected file header also brightens its text, which must follow focus the same way.
      const headerFg = () =>
        spanWith(captureSpans(), "src/a.ts")?.fg ?? RGBA.fromHex("#000");

      expect(state.searchIndex()).toBe(0);
      expect(
        sameColor(headerFg(), RGBA.fromHex(theme.colors.text.selected))
      ).toBe(true);

      state.setFocusedPane("tree");
      await settleUntil("result unlit off focus", () => !resultLit());
      expect(state.mainView()).toBe("search");
      expect(
        sameColor(headerFg(), RGBA.fromHex(theme.colors.text.strong))
      ).toBe(true);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("a loading tree marks focus with an empty cursor band and no text", async () => {
    seedState(
      {
        branch: undefined,
        changed: [],
        changedByPath: new Map(),
        repoFiles: [],
        repoFilesKey: "",
        repoRoot: "",
        scopeKey: "",
      },
      { kind: "all", ref: "HEAD" }
    );

    const { renderer, renderOnce, captureCharFrame, captureSpans, mockInput } =
      await testRender(() => <App />, { height: 16, width: 100 });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });
    const cursor = RGBA.fromHex(theme.colors.surface.cursor);

    const treeBand = () => {
      const { sidebar } = state.layout();

      return hasBackgroundIn(
        captureSpans(),
        cursor,
        sidebar.content.x,
        sidebar.content.x + sidebar.content.width
      );
    };

    try {
      await settleUntil("shell", (frame) => frame.includes("q quit"));
      expect(state.repoFilesLoading()).toBe(true);
      expect(state.focusedPane()).toBe("tree");
      await settleUntil("cursor band on the focused tree", treeBand);
      // An empty list mid-load is not yet an empty repository.
      expect(captureCharFrame()).toContain("select a file to inspect");
      expect(captureCharFrame()).not.toContain("has no files yet");

      mockInput.pressTab();
      await settleUntil("viewer focused", () => state.focusedPane() === "diff");
      await settleUntil("band gone off focus", () => !treeBand());
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("the find prompt carries the viewer's focus while find replaces the title", async () => {
    const repoRoot = createFixtureRepo("stet-focus-find-", {
      "src/a.ts": "const a = 1\n",
    });

    writeFileSync(path.join(repoRoot, "src", "a.ts"), "const a = 2\n");

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });

    const { renderer, renderOnce, captureCharFrame, captureSpans, mockInput } =
      await testRender(() => <App />, { height: 16, width: 100 });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    const promptFg = () =>
      spanWith(captureSpans(), "/ ")?.fg ?? RGBA.fromHex("#000");

    try {
      await settleUntil("diff loaded", (frame) => frame.includes("const a"));
      mockInput.pressTab();
      await settleUntil("viewer focused", () => state.focusedPane() === "diff");
      mockInput.pressKey("/");
      await settleUntil("find open", () => state.findOpen());
      await mockInput.typeText("c");
      mockInput.pressEnter();
      await settleUntil("find committed", () => state.findActive());
      await renderOnce();
      expect(
        sameColor(promptFg(), RGBA.fromHex(theme.colors.accent.primary))
      ).toBe(true);

      mockInput.pressTab();
      await settleUntil("tree focused", () => state.focusedPane() === "tree");
      await renderOnce();
      expect(state.findActive()).toBe(true);
      expect(sameColor(promptFg(), RGBA.fromHex(theme.colors.text.muted))).toBe(
        true
      );
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("a click on the tree cancels an open find bar so the keys follow focus", async () => {
    const repoRoot = createFixtureRepo("stet-focus-find-click-", {
      "src/a.ts": "const a = 1\n",
    });

    writeFileSync(path.join(repoRoot, "src", "a.ts"), "const a = 2\n");

    const model = await loadModel(repoRoot, { kind: "all", ref: "HEAD" });
    seedState(model, { kind: "all", ref: "HEAD" });

    const { renderer, renderOnce, captureCharFrame, mockInput, mockMouse } =
      await testRender(() => <App />, { height: 16, width: 100 });

    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });

    try {
      await settleUntil("diff loaded", (frame) => frame.includes("const a"));
      mockInput.pressTab();
      await settleUntil("viewer focused", () => state.focusedPane() === "diff");
      mockInput.pressKey("/");
      await settleUntil("find open", () => state.findOpen());

      const { sidebar } = state.layout();
      await mockMouse.click(sidebar.content.x + 2, sidebar.content.y);
      await settleUntil("tree focused", () => state.focusedPane() === "tree");
      expect(state.findOpen()).toBe(false);
    } finally {
      renderer.destroy();
    }
  }, 20_000);
});
