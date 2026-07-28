import { expect, test } from "bun:test";

import type { DockedPane, Layout, LayoutInput } from "@/layout/regions";
import { computeLayout, PROBLEMS_DEFAULT_HEIGHT } from "@/layout/regions";

const pane = (overrides: Partial<DockedPane> = {}): DockedPane => ({
  heightOverride: null,
  open: true,
  position: "left",
  widthOverride: null,
  ...overrides,
});

const layout = (overrides: Partial<LayoutInput> = {}) =>
  computeLayout({
    problems: pane({ open: false, position: "bottom" }),
    sidebar: pane(),
    terminalHeight: 24,
    terminalWidth: 80,
    zoom: undefined,
    ...overrides,
  });

// Cells a region actually occupies, so overlap and gaps are both detectable by
// Counting rather than by comparing edges pair by pair.
const cells = ({ height, width, x, y }: { height: number; width: number; x: number; y: number }) =>
  Array.from({ length: height }, (_row, row) =>
    Array.from({ length: width }, (_column, column) => `${x + column},${y + row}`),
  ).flat();

const covered = (result: Layout) => [
  ...cells(result.header),
  ...cells(result.sidebar),
  ...cells(result.viewer),
  ...cells(result.problems),
  ...cells(result.status),
];

const DOCKS = ["bottom", "left", "right", "top"] as const;

test("the regions tile the terminal exactly, for every pairing of docks", () => {
  for (const sidebarPosition of DOCKS) {
    for (const problemsPosition of DOCKS) {
      for (const [width, height] of [
        [80, 24],
        [120, 40],
        [200, 60],
      ]) {
        const painted = covered(
          layout({
            problems: pane({ open: true, position: problemsPosition }),
            sidebar: pane({ position: sidebarPosition }),
            terminalHeight: height,
            terminalWidth: width,
          }),
        );
        const where = `${sidebarPosition}/${problemsPosition} at ${width}x${height}`;
        expect(`${where}: ${painted.length}`).toBe(`${where}: ${width * height}`);
        expect(`${where}: ${new Set(painted).size}`).toBe(`${where}: ${width * height}`);
      }
    }
  }
});

test("the default arrangement reproduces the shell it replaces", () => {
  const result = layout({ problems: pane({ open: true, position: "bottom" }), terminalHeight: 24 });

  expect(result.header).toEqual({ height: 1, width: 80, x: 0, y: 0 });
  expect(result.status).toEqual({ height: 1, width: 80, x: 0, y: 23 });
  // The tree docks left at the responsive default and runs the full band height.
  expect(result.sidebar.width).toBe(34);
  expect(result.sidebar.x).toBe(0);
  // The panel spans the whole terminal, the tree included, and the viewer keeps
  // The `terminalHeight - header - status - border` rows it had as `paneHeight`.
  expect(result.problems.width).toBe(80);
  expect(result.problems.height).toBe(PROBLEMS_DEFAULT_HEIGHT);
  expect(result.viewer.content.height).toBe(24 - 4 - PROBLEMS_DEFAULT_HEIGHT);
});

test("content is the frame inside its single-cell border", () => {
  const result = layout({ problems: pane({ open: true, position: "bottom" }) });

  expect(result.sidebar.content).toEqual({
    height: result.sidebar.height - 2,
    width: result.sidebar.width - 2,
    x: result.sidebar.x + 1,
    y: result.sidebar.y + 1,
  });
  expect(result.problems.content.width).toBe(78);
});

test("a closed pane is a zero rect and yields its space to the viewer", () => {
  const result = layout({ sidebar: pane({ open: false }) });

  expect(result.sidebar).toEqual({
    content: { height: 0, width: 0, x: 0, y: 0 },
    height: 0,
    width: 0,
    x: 0,
    y: 0,
  });
  expect(result.viewer.width).toBe(80);
});

test("the responsive width follows the terminal between its floor and ceiling", () => {
  expect(layout({ terminalWidth: 80 }).sidebar.width).toBe(34);
  expect(layout({ terminalWidth: 200 }).sidebar.width).toBe(54);
  // At 60 columns the responsive default (34) exceeds the viewer-preserving max.
  expect(layout({ terminalWidth: 60 }).sidebar.width).toBe(32);
});

test("a manual width is clamped by the terminal but never destroyed by it", () => {
  const wide = pane({ widthOverride: 50 });

  expect(layout({ sidebar: wide, terminalWidth: 80 }).sidebar.width).toBe(50);
  expect(layout({ sidebar: wide, terminalWidth: 40 }).sidebar.width).toBe(24);
  // The same input at the original size is untouched: the clamp never wrote back.
  expect(layout({ sidebar: wide, terminalWidth: 80 }).sidebar.width).toBe(50);
});

test("a docked pane never squeezes the viewer out of the terminal", () => {
  const result = layout({
    problems: pane({ open: true, position: "bottom" }),
    terminalHeight: 12,
  });

  expect(result.problems.height).toBeLessThan(PROBLEMS_DEFAULT_HEIGHT);
  expect(result.viewer.height).toBeGreaterThanOrEqual(4);
});

test("the right dock swaps the columns and changes no width", () => {
  const left = layout({ sidebar: pane({ position: "left" }) });
  const right = layout({ sidebar: pane({ position: "right" }) });

  expect(right.sidebar.width).toBe(left.sidebar.width);
  expect(right.viewer.width).toBe(left.viewer.width);
  expect(right.viewer.x).toBe(0);
  expect(right.sidebar.x).toBe(left.viewer.width);
});

test("docking the tree on top stacks it over the viewer and the panel", () => {
  const result = layout({
    problems: pane({ open: true, position: "bottom" }),
    sidebar: pane({ position: "top" }),
    terminalHeight: 40,
  });

  expect(result.sidebar.width).toBe(80);
  expect(result.viewer.width).toBe(80);
  expect(result.problems.width).toBe(80);
  expect(result.sidebar.y).toBeLessThan(result.viewer.y);
  expect(result.viewer.y).toBeLessThan(result.problems.y);
});

test("a bottom-docked panel spans the terminal while a left-docked tree runs full height", () => {
  const result = layout({ problems: pane({ open: true, position: "bottom" }) });

  expect(result.problems.width).toBe(80);
  expect(result.problems.x).toBe(0);
  expect(result.sidebar.height).toBe(result.viewer.height);
});

test("a pair on one axis leaves the viewer its minimum, not just the first of them", () => {
  // Each carve sees only the band as it stands, so without reserving the second
  // Pane's minimum up front the pair walks the viewer under its floor while both
  // Carves look correct alone. 24 + 24 + 28 fits in 85 columns, so it must.
  const columns = layout({
    problems: pane({ open: true, position: "left" }),
    sidebar: pane({ position: "left" }),
    terminalWidth: 85,
  });
  expect(columns.viewer.width).toBeGreaterThanOrEqual(28);
  expect(columns.problems.width).toBeGreaterThanOrEqual(24);
  expect(columns.sidebar.width).toBeGreaterThanOrEqual(24);

  // The same hole on the vertical axis: 5 + 5 + 4 fits in an 18-row terminal.
  const rows = layout({
    problems: pane({ open: true, position: "bottom" }),
    sidebar: pane({ position: "top" }),
    terminalHeight: 18,
  });
  expect(rows.viewer.height).toBeGreaterThanOrEqual(4);
  expect(rows.problems.height).toBeGreaterThanOrEqual(5);
  expect(rows.sidebar.height).toBeGreaterThanOrEqual(5);
});

test("two panes on the same edge stack, the panel outermost", () => {
  const result = layout({
    problems: pane({ open: true, position: "bottom" }),
    sidebar: pane({ position: "bottom" }),
    terminalHeight: 40,
  });

  expect(result.problems.y).toBeGreaterThan(result.sidebar.y);
  expect(result.sidebar.y).toBeGreaterThan(result.viewer.y);
});

test("zoom gives one pane the band without touching the open flags", () => {
  const open = { problems: pane({ open: true, position: "bottom" }), sidebar: pane() };

  const zoomed = layout({ ...open, zoom: "viewer" });
  expect(zoomed.viewer.height).toBe(22);
  expect(zoomed.viewer.width).toBe(80);
  expect(zoomed.sidebar.width).toBe(0);
  expect(zoomed.problems.height).toBe(0);

  expect(layout({ ...open, zoom: "tree" }).sidebar.width).toBe(80);
  expect(layout({ ...open, zoom: "problems" }).problems.height).toBe(22);
  // The header and status rows are never zoomed away.
  expect(layout({ ...open, zoom: "tree" }).header.height).toBe(1);
});
