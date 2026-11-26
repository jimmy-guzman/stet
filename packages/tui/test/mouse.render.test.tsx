import { describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { MouseButton, rgbToHex } from "@opentui/core";
import { testRender } from "@opentui/solid";

import { App } from "@/app";
import { pointerStyle } from "@/components/pointer";
import { state } from "@/state";
import { selection } from "@/theme/active";
import { theme } from "@/theme/context";

import {
  createFixtureRepo,
  loadModel,
  makeSettleUntil,
  seedState,
} from "./helpers";

const scope = { kind: "all", ref: "HEAD" } as const;

const mount = async () => {
  const repoRoot = createFixtureRepo("stet-mouse-", {
    "notes.md": "note\n",
    "src/a.ts": "base\n",
    "src/b.ts": "bee\n",
  });

  writeFileSync(path.join(repoRoot, "src", "a.ts"), "const alpha = 1;\n");
  writeFileSync(path.join(repoRoot, "src", "b.ts"), "const beta = 2;\n");
  seedState(await loadModel(repoRoot, scope), scope);

  const app = await testRender(() => <App />, { height: 30, width: 110 });

  return { ...app, settleUntil: makeSettleUntil(app) };
};

/** The first cell of `text` in the frame, below row `from`. */
const cellOf = (frame: string, text: string, from = 0) => {
  const rows = frame.split("\n");
  const y = rows.findIndex((row, index) => index >= from && row.includes(text));
  const row = rows[y] ?? "";

  return { x: Bun.stringWidth(row.slice(0, row.indexOf(text))), y };
};

// A tree row's cell, read left of the divider so a name the viewer also shows never matches there.
const treeCell = (frame: string, name: string) => {
  const rows = frame.split("\n");
  const y = rows.findIndex((row) => (row.split("│")[0] ?? "").includes(name));

  return { x: (rows[y] ?? "").indexOf(name), y };
};

// A side button, as SGR reports it: OpenTUI's mock mouse knows only the left, middle, and right.
const pressSideButton = (
  renderer: { stdin: NodeJS.ReadStream },
  code: 128 | 129,
  x: number,
  y: number
) => {
  renderer.stdin.emit(
    "data",
    Buffer.from(`\u001B[<${code};${x + 1};${y + 1}M`)
  );
  renderer.stdin.emit(
    "data",
    Buffer.from(`\u001B[<${code};${x + 1};${y + 1}m`)
  );
};

describe("clickable chrome", () => {
  test("the header's fields open what their keys open", async () => {
    const { mockInput, mockMouse, renderer, settleUntil } = await mount();

    try {
      const frame = await settleUntil("loaded", (current) =>
        current.includes("alpha")
      );

      const scopeCell = cellOf(frame, "uncommitted");
      await mockMouse.click(scopeCell.x, scopeCell.y);
      await settleUntil("scope menu", () => state.scopeMenuOpen());
      mockInput.pressEscape();
      await settleUntil("scope menu closed", () => !state.scopeMenuOpen());

      const changed = cellOf(frame, "2 changed");
      await mockMouse.click(changed.x, changed.y);
      expect(state.changesOnly()).toBe(true);
      await mockMouse.click(changed.x, changed.y);
      expect(state.changesOnly()).toBe(false);

      const identity = cellOf(frame, "stet-mouse-");
      await mockMouse.click(identity.x, identity.y);
      await settleUntil("worktree picker", () => state.worktreeComboboxOpen());
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("the status hints do what they name, and the quit dialog's answers too", async () => {
    const { mockMouse, renderer, settleUntil } = await mount();

    try {
      const frame = await settleUntil("loaded", (current) =>
        current.includes("? help")
      );

      const help = cellOf(frame, "? help");
      await mockMouse.click(help.x, help.y);
      await settleUntil("help", () => state.helpDialogOpen());

      // The marks tab switches the view, as `tab` does.
      const dialog = await settleUntil("help shown", (current) =>
        current.includes("marks")
      );

      const marks = cellOf(dialog, "marks");
      await mockMouse.click(marks.x, marks.y);
      expect(state.helpView()).toBe("marks");

      // A press outside the dialog closes it rather than acting on the tree under it.
      const before = state.selectedPath();
      const outside = treeCell(frame, "notes.md");
      await mockMouse.click(outside.x, outside.y);
      await settleUntil("help closed", () => !state.helpDialogOpen());
      expect(state.selectedPath()).toBe(before);

      const hints = await settleUntil("hints", (current) =>
        current.includes("q quit")
      );

      const quitHint = cellOf(hints, "q quit");
      await mockMouse.click(quitHint.x, quitHint.y);

      const confirm = await settleUntil("confirm", (current) =>
        current.includes("esc cancel")
      );

      // The alert dialog is not dismissible: a press outside it changes nothing.
      await mockMouse.click(outside.x, outside.y);
      expect(state.quitConfirmOpen()).toBe(true);

      const cancel = cellOf(confirm, "esc cancel");
      await mockMouse.click(cancel.x, cancel.y);
      await settleUntil("confirm closed", () => !state.quitConfirmOpen());
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("the viewer's stats switch between the diff and the file", async () => {
    const { mockMouse, renderer, settleUntil } = await mount();

    try {
      const frame = await settleUntil("loaded", (current) =>
        current.includes("alpha")
      );

      const stats = cellOf(frame, "+1 -1", 1);
      await mockMouse.click(stats.x + 1, stats.y);
      await settleUntil("file view", (current) => current.includes("1 lines"));
      expect(state.fileView()).toBe(true);
    } finally {
      renderer.destroy();
    }
  }, 20_000);
});

describe("buttons", () => {
  test("a middle press acts on nothing, and the side buttons step history", async () => {
    const { mockMouse, renderer, renderOnce, settleUntil } = await mount();

    try {
      const frame = await settleUntil("loaded", (current) =>
        current.includes("alpha")
      );

      const first = state.selectedPath();
      const other = treeCell(frame, "b.ts");
      await mockMouse.click(other.x, other.y, MouseButton.MIDDLE);
      expect(state.selectedPath()).toBe(first);

      await mockMouse.click(other.x, other.y);
      await settleUntil("opened b", () => state.selectedPath() === "src/b.ts");

      pressSideButton(renderer, 128, 60, 10);
      await renderOnce();
      expect(state.selectedPath()).toBe(first);

      pressSideButton(renderer, 129, other.x, other.y);
      await renderOnce();
      expect(state.selectedPath()).toBe("src/b.ts");
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("with the context menu open, a left press only closes it", async () => {
    const { mockMouse, renderer, settleUntil } = await mount();

    try {
      const frame = await settleUntil("loaded", (current) =>
        current.includes("alpha")
      );

      const before = state.selectedPath();
      const notes = treeCell(frame, "notes.md");
      await mockMouse.click(notes.x, notes.y, MouseButton.RIGHT);
      await settleUntil("menu", (current) => current.includes("Copy path"));

      // The header's changed count sits outside the menu and would toggle on a plain click.
      const header = cellOf(frame, "2 changed");
      await mockMouse.click(header.x, header.y);
      await settleUntil("menu closed", () => !state.commandMenuOpen());
      expect(state.changesOnly()).toBe(false);

      await mockMouse.click(notes.x, notes.y, MouseButton.RIGHT);
      await settleUntil("menu again", () => state.commandMenuOpen());

      const other = treeCell(frame, "b.ts");
      await mockMouse.click(other.x, other.y);
      await settleUntil("menu closed again", () => !state.commandMenuOpen());
      expect(state.selectedPath()).toBe(before);
    } finally {
      renderer.destroy();
    }
  }, 20_000);
});

describe("overlays", () => {
  test("a press outside the theme picker reverts its preview and closes it", async () => {
    const { mockInput, mockMouse, renderer, settleUntil } = await mount();

    try {
      const frame = await settleUntil("loaded", (current) =>
        current.includes("alpha")
      );

      mockInput.pressKey("t");

      const picker = await settleUntil("picker", (current) =>
        current.includes("stet-light")
      );

      const row = cellOf(picker, "stet-light");
      await mockMouse.moveTo(row.x, row.y);
      await settleUntil("previewing", () => selection() === "stet-light");

      const outside = treeCell(frame, "notes.md");
      await mockMouse.click(outside.x, outside.y);
      await settleUntil("closed", () => !state.themeComboboxOpen());
      expect(selection()).toBeUndefined();
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("the picker highlight follows the pointer's motion, not a scroll under it", async () => {
    const { mockInput, mockMouse, renderer, renderOnce, settleUntil } =
      await mount();

    try {
      await settleUntil("loaded", (current) => current.includes("alpha"));
      mockInput.pressKey("t");

      const picker = await settleUntil("picker", (current) =>
        current.includes("stet-light")
      );

      const row = cellOf(picker, "stet-light");
      await mockMouse.moveTo(row.x, row.y);

      const hovered = state.themeComboboxIndex();

      // Walk the highlight past the list's end so the list scrolls under the still pointer, which
      // Puts another row beneath it without the pointer moving.
      for (const _ of Array.from({ length: 15 })) {
        mockInput.pressArrow("down");
      }

      await renderOnce();
      await renderOnce();

      expect(state.themeComboboxIndex()).toBe(hovered + 15);
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("find keeps the keyboard after a picker the mouse opened", async () => {
    const { mockInput, mockMouse, renderer, renderOnce, settleUntil } =
      await mount();

    try {
      const frame = await settleUntil("loaded", (current) =>
        current.includes("alpha")
      );

      mockInput.pressKey("/");
      await settleUntil("find", () => state.findOpen());

      const scopeCell = cellOf(frame, "uncommitted");
      await mockMouse.click(scopeCell.x, scopeCell.y);
      await settleUntil("scope menu", () => state.scopeMenuOpen());
      mockInput.pressEscape();
      await settleUntil("scope menu closed", () => !state.scopeMenuOpen());

      await mockInput.typeText("alp");
      await renderOnce();
      expect(state.findQuery()).toBe("alp");
    } finally {
      renderer.destroy();
    }
  }, 20_000);
});

describe("pointer", () => {
  test("shows what a press would do, and never sticks to a target that went away", async () => {
    const { mockInput, mockMouse, renderer, renderOnce, settleUntil } =
      await mount();

    try {
      const frame = await settleUntil("loaded", (current) =>
        current.includes("alpha")
      );

      const row = treeCell(frame, "notes.md");
      await mockMouse.moveTo(row.x, row.y);
      expect(pointerStyle()).toBe("pointer");

      const code = cellOf(frame, "alpha", 1);
      await mockMouse.moveTo(code.x, code.y);
      expect(pointerStyle()).toBe("text");

      const divider = state.layout().junction ?? -1;
      await mockMouse.moveTo(divider, 10);
      expect(pointerStyle()).toBe("col-resize");

      // A click on a picker row closes the picker under the pointer; what lies beneath claims it.
      mockInput.pressKey("p", { ctrl: true });

      const picker = await settleUntil("picker", (current) =>
        current.includes("notes.md")
      );

      const pickRow = picker
        .split("\n")
        .findIndex((line) => line.includes("notes.md", state.overlayLeft()));

      const pick = {
        x: (picker.split("\n")[pickRow] ?? "").indexOf(
          "notes.md",
          state.overlayLeft()
        ),
        y: pickRow,
      };

      await mockMouse.moveTo(pick.x, pick.y);
      expect(pointerStyle()).toBe("pointer");
      await mockMouse.click(pick.x, pick.y);
      await settleUntil("closed", () => !state.fileComboboxOpen());
      await renderOnce();
      expect(pointerStyle()).not.toBe("pointer");
    } finally {
      renderer.destroy();
    }
  }, 20_000);

  test("tints the tree row under the pointer, never the cursor's", async () => {
    const { captureSpans, mockMouse, renderer, settleUntil } = await mount();

    const tinted = (y: number) =>
      captureSpans().lines[y]?.spans.some(
        (span) => rgbToHex(span.bg) === theme.colors.surface.hover
      ) ?? false;

    try {
      const frame = await settleUntil("loaded", (current) =>
        current.includes("alpha")
      );

      const notes = treeCell(frame, "notes.md");
      expect(tinted(notes.y)).toBe(false);

      await mockMouse.moveTo(notes.x, notes.y);
      await settleUntil("tinted", () => tinted(notes.y));

      // Moving off the row clears its tint.
      const code = cellOf(frame, "alpha", 1);
      await mockMouse.moveTo(code.x, code.y);
      await settleUntil("untinted", () => !tinted(notes.y));

      // The cursor row keeps its own band under the pointer.
      const cursor = treeCell(frame, "a.ts");
      await mockMouse.click(cursor.x, cursor.y);
      await mockMouse.moveTo(cursor.x + 1, cursor.y);
      await settleUntil("cursor row", () => state.focusedPane() === "tree");
      expect(tinted(cursor.y)).toBe(false);
      expect(
        captureSpans().lines[cursor.y]?.spans.some(
          (span) => rgbToHex(span.bg) === theme.colors.surface.cursor
        )
      ).toBe(true);
    } finally {
      renderer.destroy();
    }
  }, 20_000);
});
