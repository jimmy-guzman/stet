import { describe, expect, test } from "bun:test";

import {
  buildStatusBarModel,
  clearAlertSource,
  latestAlert,
  raiseAlert,
} from "@/status/model";
import type { StatusBarModelInput } from "@/status/model";

const baseInput = {
  activity: undefined,
  alert: undefined,
  foregroundProgress: undefined,
  guidance: "? help · q quit",
  notification: undefined,
  width: 80,
} satisfies StatusBarModelInput;

const activity = {
  at: 1000,
  changeKind: "modified",
  path: "src/state.ts",
} as const;

describe("status bar guidance", () => {
  test("an idle bar falls back to guidance", () => {
    expect(buildStatusBarModel(baseInput)).toEqual({
      category: "guidance",
      kind: "guidance",
      text: "? help · q quit",
    });
  });

  test("guidance renders whatever mode text it is handed", () => {
    expect(
      buildStatusBarModel({ ...baseInput, guidance: "enter find · esc cancel" })
    ).toMatchObject({ kind: "guidance", text: "enter find · esc cancel" });
  });

  test("live content displaces guidance, and clearing it restores guidance", () => {
    const busy = buildStatusBarModel({
      ...baseInput,
      foregroundProgress: "switching…",
    });

    expect(busy).toMatchObject({ kind: "message", message: "switching…" });

    // The model is a pure function of its inputs, so "the switch finished" is the absent input.
    expect(buildStatusBarModel(baseInput)).toMatchObject({ kind: "guidance" });
  });
});

// Each pair proves one step of the ladder; together they fix the total order. Every case pits a
// Tier against the one directly below it, so a reordering fails exactly one test.
describe("status bar priority", () => {
  test("foreground progress outranks a notification", () => {
    expect(
      buildStatusBarModel({
        ...baseInput,
        foregroundProgress: "switching to feat/status…",
        notification: { level: "success", text: "copied src/state.ts" },
      })
    ).toMatchObject({
      category: "foreground-progress",
      level: "info",
      message: "switching to feat/status…",
    });
  });

  test("a notification outranks a persistent alert", () => {
    expect(
      buildStatusBarModel({
        ...baseInput,
        alert: {
          level: "error",
          source: "worktree-switch",
          text: "missing worktree",
        },
        notification: { level: "success", text: "copied src/state.ts" },
      })
    ).toMatchObject({
      category: "notification",
      level: "success",
      message: "copied src/state.ts",
    });
  });

  test("recent activity outranks guidance", () => {
    expect(buildStatusBarModel({ ...baseInput, activity })).toEqual({
      activity,
      category: "ambient",
      kind: "ambient",
    });
  });
});

describe("status bar alerts", () => {
  const switchFail = {
    level: "warning",
    source: "worktree-switch",
    text: "missing worktree",
  } as const;

  const listFail = {
    level: "error",
    source: "worktree-list",
    text: "couldn't list worktrees",
  } as const;

  // A failed list and a failed switch are separate lifecycles: reopening the picker (which clears
  // The list source) must not retire an unretried switch error.
  test("clearing the list source leaves a switch failure standing", () => {
    const raised = raiseAlert(raiseAlert([], switchFail), listFail);

    expect(clearAlertSource(raised, "worktree-list")).toEqual([switchFail]);
  });

  test("clearing a source with no alert is a no-op", () => {
    expect(clearAlertSource([switchFail], "worktree-list")).toEqual([
      switchFail,
    ]);
  });

  test("a source raising again replaces its own alert rather than stacking", () => {
    const raised = raiseAlert([listFail], { ...listFail, text: "git failed" });

    expect(raised).toEqual([{ ...listFail, text: "git failed" }]);
  });

  // One row cannot rank one failure against another, so recency decides: the problem the user
  // Just provoked is the one they are waiting on.
  test("the newest alert is the one the bar shows", () => {
    expect(
      latestAlert(raiseAlert(raiseAlert([], switchFail), listFail))
    ).toEqual(listFail);
    expect(
      latestAlert(raiseAlert(raiseAlert([], listFail), switchFail))
    ).toEqual(switchFail);
  });

  test("a re-raised source becomes the newest", () => {
    const raised = raiseAlert(raiseAlert([], listFail), switchFail);

    expect(latestAlert(raiseAlert(raised, listFail))).toEqual(listFail);
  });

  test("no alerts reads as none", () => {
    expect(latestAlert([])).toBeUndefined();
  });
});

describe("status bar fitting", () => {
  test("a message truncates to the row, leaving room for its severity glyph", () => {
    const model = buildStatusBarModel({
      ...baseInput,
      alert: {
        level: "error",
        source: "worktree-list",
        text: "couldn't list worktrees: git exited with a long and winding explanation",
      },
      width: 30,
    });

    if (model.kind !== "message") {
      throw new Error("expected a message");
    }

    // The glyph, its space, and both paddings all come out of the same 30 cells.
    expect(Bun.stringWidth(`✖ ${model.message}`)).toBeLessThanOrEqual(28);
    expect(model.message.startsWith("couldn't list")).toBe(true);
  });

  test("a long activity path truncates from the front, keeping the filename", () => {
    const model = buildStatusBarModel({
      ...baseInput,
      activity: {
        ...activity,
        path: `src/${"components/".repeat(20)}DiffView.tsx`,
      },
      width: 40,
    });

    if (model.kind !== "ambient") {
      throw new Error("expected ambient activity");
    }

    expect(model.activity.path).toStartWith("…");
    expect(model.activity.path).toEndWith("DiffView.tsx");
    expect(Bun.stringWidth(`● ${model.activity.path}`)).toBeLessThanOrEqual(38);
  });

  // A path cut down to the ellipsis alone names no file, so it has nothing to say that guidance
  // Does not say better. Five cells is where the budget collapses that far: two go to the row's
  // Padding and two to the recency dot, leaving one.
  test("an activity path with no room left yields the row to guidance", () => {
    expect(
      buildStatusBarModel({
        ...baseInput,
        activity: { ...activity, path: "src/components/StatusBar.tsx" },
        width: 5,
      })
    ).toMatchObject({ kind: "guidance" });
  });

  test("fit is measured in terminal cells, not string length", () => {
    const model = buildStatusBarModel({
      ...baseInput,
      activity: { ...activity, path: "src/🐛🐛🐛🐛🐛🐛.ts" },
      width: 20,
    });

    if (model.kind !== "ambient") {
      throw new Error("expected ambient activity");
    }

    // Each bug is two cells wide but one code point; a length-based budget would overflow the row.
    expect(Bun.stringWidth(`● ${model.activity.path}`)).toBeLessThanOrEqual(18);
  });

  test("guidance itself truncates rather than overflowing a narrow row", () => {
    const model = buildStatusBarModel({ ...baseInput, width: 10 });

    expect(
      Bun.stringWidth(model.kind === "guidance" ? model.text : "")
    ).toBeLessThanOrEqual(8);
  });
});
