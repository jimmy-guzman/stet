import { describe, expect, test } from "bun:test";

import { createTwoFilesPatch } from "@pierre/patches";

import { renderDiff } from "@/diff/engine";
import type { DiffRow } from "@/diff/rows";
import { buildDiffInput } from "@/git/file-patch";
import type { ChangedFile } from "@/git/model";

const modified: ChangedFile = {
  additions: 1,
  binary: false,
  deletions: 1,
  kind: "modified",
  mtimeMs: 0,
  path: "x.ts",
  stage: "unstaged",
  warnings: [],
};

// Thirty numbered lines with one edit at line 11: a 7-line gap above the hunk and a
// 16-line gap below it.
const OLD = `${Array.from({ length: 30 }, (_, i) => `const a${i + 1} = ${i + 1};`).join("\n")}\n`;
const NEW = OLD.replace("const a11 = 11;", "const a11 = 110;");

const built = (oldText: string, newText: string) => {
  const result = buildDiffInput(
    modified,
    { kind: "text", text: oldText },
    { kind: "text", text: newText }
  );

  if (result === undefined || !("files" in result)) {
    throw new Error("expected an in-process diff");
  }

  return result;
};

// A unified patch with no files beside it, the shape git's fallback hands the engine.
const patchOnly = (oldText: string, newText: string) => ({
  patch: createTwoFilesPatch(
    "a/x.ts",
    "b/x.ts",
    oldText,
    newText,
    undefined,
    undefined,
    { context: 3 }
  ),
});

const describeRow = (row: DiffRow) => {
  if (row.kind === "line") {
    return `${row.type}:${row.oldLine ?? "-"}/${row.newLine ?? "-"}`;
  }

  if (row.kind === "marker") {
    return `${row.collapsed ? "gap" : "open"}:${row.key}:${row.count}`;
  }

  return `sep:${row.text}`;
};

describe("diff rows", () => {
  test("emits unified rows with deletions before additions and tracked line numbers", async () => {
    const input = patchOnly(OLD, NEW);
    const render = await renderDiff({ full: false, maxLines: 1600, ...input });

    expect(render.hiddenLines).toBe(0);
    expect(render.rows.map(describeRow)).toEqual([
      "sep:7 unmodified lines",
      "context:8/8",
      "context:9/9",
      "context:10/10",
      "remove:11/-",
      "add:-/11",
      "context:12/12",
      "context:13/13",
      "context:14/14",
    ]);
  });

  test("a patch-only diff singularizes a one-line gap's label", async () => {
    const input = patchOnly(
      OLD,
      OLD.replace("const a5 = 5;", "const a5 = 50;")
    );

    const render = await renderDiff({ full: false, maxLines: 1600, ...input });

    expect(render.rows[0]).toEqual({
      glyph: "⋯",
      kind: "separator",
      text: "1 unmodified line",
    });
    expect(render.gapAtLine(1, "newLine")).toBeUndefined();
  });

  test("with both sides, every gap (the trailing one too) is a collapsed marker keyed by the hunk it precedes", async () => {
    const input = built(OLD, NEW);

    const render = await renderDiff({
      full: false,
      maxLines: 1600,
      ...input,
    });

    expect(render.rows.map(describeRow)).toEqual([
      "gap:gap:0:7",
      "context:8/8",
      "context:9/9",
      "context:10/10",
      "remove:11/-",
      "add:-/11",
      "context:12/12",
      "context:13/13",
      "context:14/14",
      "gap:gap:1:16",
    ]);
    expect(render.gapAtLine(1, "newLine")).toBe("gap:0");
    expect(render.gapAtLine(7, "newLine")).toBe("gap:0");
    expect(render.gapAtLine(8, "newLine")).toBeUndefined();
    expect(render.gapAtLine(14, "newLine")).toBeUndefined();
    expect(render.gapAtLine(15, "newLine")).toBe("gap:1");
    expect(render.gapAtLine(30, "newLine")).toBe("gap:1");
    expect(render.gapAtLine(31, "newLine")).toBeUndefined();
  });

  test("finds a trailing gap in the line numbers of each diff side", async () => {
    const render = await renderDiff({
      full: false,
      maxLines: 1600,
      ...built(OLD, `const inserted = true;\n${NEW}`),
    });

    expect(render.gapAtLine(15, "oldLine")).toBe("gap:2");
    expect(render.gapAtLine(15, "newLine")).toBeUndefined();
    expect(render.gapAtLine(31, "oldLine")).toBeUndefined();
    expect(render.gapAtLine(31, "newLine")).toBe("gap:2");
  });

  test("expanding a gap reveals its lines highlighted behind a hide marker, with contiguous navIndex", async () => {
    const input = built(OLD, NEW);

    const render = await renderDiff({
      full: false,
      maxLines: 1600,
      ...input,
    });

    const layout = render.expand(new Set(["gap:0"]));

    expect(layout.rows.slice(0, 3).map(describeRow)).toEqual([
      "open:gap:0:7",
      "context:1/1",
      "context:2/2",
    ]);

    const [, first] = layout.rows;

    expect(first?.kind === "line" && first.spans.length).toBeGreaterThan(1);
    expect(layout.navigable[0]?.content).toBe("const a1 = 1;");
    expect(
      layout.rows.flatMap((row) => (row.kind === "line" ? [row.navIndex] : []))
    ).toEqual(layout.navigable.map((_, index) => index));
  });

  test("emits no gap when the hunk starts at line 1", async () => {
    const input = built(OLD, OLD.replace("const a1 = 1;", "const a1 = 10;"));

    const render = await renderDiff({
      full: false,
      maxLines: 1600,
      ...input,
    });

    expect(render.rows[0]?.kind).toBe("line");
  });

  test("marks a missing trailing newline with git's own row", async () => {
    const input = patchOnly(OLD, NEW.trimEnd());
    const render = await renderDiff({ full: false, maxLines: 1600, ...input });

    expect(render.rows.at(-1)).toEqual({
      glyph: "\\",
      kind: "separator",
      text: "No newline at end of file",
    });
  });

  test("caps body lines at maxLines and counts the hidden rest, ignoring the cap when full", async () => {
    const input = built(OLD, NEW);

    const capped = await renderDiff({ full: false, maxLines: 3, ...input });

    expect(capped.hiddenLines).toBe(5);
    expect(capped.navigable).toHaveLength(3);
    expect(capped.gapAtLine(15, "newLine")).toBeUndefined();

    // Revealing the gap above the cap shows its lines but pulls in nothing below it.
    const expanded = capped.expand(new Set(["gap:0"]));

    expect(
      expanded.navigable.map((line) => line.newLine ?? line.oldLine)
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const full = await renderDiff({ full: true, maxLines: 3, ...input });

    expect(full.hiddenLines).toBe(0);
    expect(full.navigable).toHaveLength(8);
  });

  test("marks the changed words of a paired removed/added line, and nothing on context lines", async () => {
    const input = patchOnly(OLD, NEW);
    const render = await renderDiff({ full: false, maxLines: 1600, ...input });

    const changedText = (type: string) =>
      render.rows
        .flatMap((row) =>
          row.kind === "line" && row.type === type ? row.spans : []
        )
        .filter((span) => span.changed === true)
        .map((span) => span.text)
        .join("");

    expect(changedText("remove")).toBe("11");
    expect(changedText("add")).toBe("110");
    expect(changedText("context")).toBe("");
  });

  test("ends a capped diff at the cap line, with no gap after it that would expand into nothing", async () => {
    // Edits at lines 12 and 25: the first hunk's 8 body lines exactly fill the cap.
    const edited = OLD.replace("const a12 = 12;", "const a12 = 120;").replace(
      "const a25 = 25;",
      "const a25 = 250;"
    );

    const input = built(OLD, edited);
    const capped = await renderDiff({ full: false, maxLines: 8, ...input });

    expect(capped.hiddenLines).toBe(8);
    expect(capped.rows.at(-1)?.kind).toBe("line");
  });

  test("keeps the cap line's own no-newline row", async () => {
    // The old side's last line `c` has no trailing newline.
    // It is the third body line, so a cap of three ends on it.
    const input = built("a\nb\nc", "a\nb\nc\nd\ne\n");
    const capped = await renderDiff({ full: false, maxLines: 3, ...input });

    expect(capped.rows.map(describeRow)).toEqual([
      "context:1/1",
      "context:2/2",
      "remove:3/-",
      "sep:No newline at end of file",
    ]);
  });
});
