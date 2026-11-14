import { expect, test } from "bun:test";

import type { DockedPane, Layout, LayoutInput } from "@/layout/regions";
import { computeLayout, DOCKS, PANE_DEFAULT_HEIGHT } from "@/layout/regions";

const pane = (overrides: Partial<DockedPane> = {}): DockedPane => ({
  heightOverride: null,
  open: true,
  position: "left",
  widthOverride: null,
  ...overrides,
});

const layout = (overrides: Partial<LayoutInput> = {}) =>
  computeLayout({
    sidebar: pane(),
    terminalHeight: 24,
    terminalWidth: 80,
    zoom: undefined,
    ...overrides,
  });

// Cells a region actually occupies, so overlap and gaps are both detectable by
// Counting rather than by comparing edges pair by pair.
const cells = ({
  height,
  width,
  x,
  y,
}: {
  height: number;
  width: number;
  x: number;
  y: number;
}) =>
  Array.from({ length: height }, (_row, row) =>
    Array.from(
      { length: width },
      (_column, column) => `${x + column},${y + row}`
    )
  ).flat();

const covered = (result: Layout) => [
  ...cells(result.header),
  ...cells(result.sidebar),
  ...cells(result.viewer),
  ...cells(result.status),
];

test("the regions tile the terminal exactly, for every dock", () => {
  for (const sidebarPosition of DOCKS) {
    for (const [width, height] of [
      [80, 24],
      [120, 40],
      [200, 60],
    ]) {
      const painted = covered(
        layout({
          sidebar: pane({ position: sidebarPosition }),
          terminalHeight: height,
          terminalWidth: width,
        })
      );
      const where = `${sidebarPosition} at ${width}x${height}`;
      expect(`${where}: ${painted.length}`).toBe(`${where}: ${width * height}`);
      expect(`${where}: ${new Set(painted).size}`).toBe(
        `${where}: ${width * height}`
      );
    }
  }
});

test("the default arrangement docks the tree left beside the viewer", () => {
  const result = layout({ terminalHeight: 24 });

  expect(result.header).toEqual({ height: 1, width: 80, x: 0, y: 0 });
  expect(result.status).toEqual({ height: 1, width: 80, x: 0, y: 23 });
  // The tree docks left at the responsive default and runs the full band height.
  expect(result.sidebar.width).toBe(34);
  expect(result.sidebar.x).toBe(0);
  expect(result.sidebar.height).toBe(result.viewer.height);
  expect(result.viewer.content.height).toBe(24 - 4);
});

test("content is the frame inside its single-cell border", () => {
  const result = layout();

  expect(result.sidebar.content).toEqual({
    height: result.sidebar.height - 2,
    width: result.sidebar.width - 2,
    x: result.sidebar.x + 1,
    y: result.sidebar.y + 1,
  });
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
    sidebar: pane({ position: "bottom" }),
    terminalHeight: 12,
  });

  expect(result.sidebar.height).toBeLessThan(PANE_DEFAULT_HEIGHT);
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

test("docking the tree on top stacks it over the viewer", () => {
  const result = layout({
    sidebar: pane({ position: "top" }),
    terminalHeight: 40,
  });

  expect(result.sidebar.width).toBe(80);
  expect(result.viewer.width).toBe(80);
  expect(result.sidebar.y).toBeLessThan(result.viewer.y);
});

test("a pane honors only the override on the axis it is docked to", () => {
  // Every `src/` call site passes both overrides now, so the model has to ignore the
  // One that does not match the edge rather than rely on the caller nulling it.
  const both = pane({ heightOverride: 20, widthOverride: 50 });

  expect(layout({ sidebar: both, terminalHeight: 40 }).sidebar.width).toBe(50);

  const top = layout({
    sidebar: { ...both, position: "top" },
    terminalHeight: 40,
  }).sidebar;
  expect(top.height).toBe(20);
  expect(top.width).toBe(80);
});

test("the default extent belongs to the axis", () => {
  const onTop = layout({
    sidebar: pane({ position: "top" }),
    terminalHeight: 40,
  });
  expect(onTop.sidebar.height).toBe(PANE_DEFAULT_HEIGHT);

  const onBottom = layout({
    sidebar: pane({ position: "bottom" }),
    terminalHeight: 40,
  });
  expect(onBottom.sidebar.height).toBe(PANE_DEFAULT_HEIGHT);
  expect(onBottom.sidebar.y).toBeGreaterThan(onBottom.viewer.y);
});

test("zoom gives one pane the band without touching the open flags", () => {
  const open = { sidebar: pane() };

  const zoomed = layout({ ...open, zoom: "viewer" });
  expect(zoomed.viewer.height).toBe(22);
  expect(zoomed.viewer.width).toBe(80);
  expect(zoomed.sidebar.width).toBe(0);

  expect(layout({ ...open, zoom: "tree" }).sidebar.width).toBe(80);
  expect(layout({ ...open, zoom: "tree" }).viewer.width).toBe(0);
  // The header and status rows are never zoomed away.
  expect(layout({ ...open, zoom: "tree" }).header.height).toBe(1);
});
