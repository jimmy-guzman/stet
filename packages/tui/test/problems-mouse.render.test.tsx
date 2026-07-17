import { describe, expect, test } from "bun:test";

import { testRender } from "@opentui/solid";

import { App } from "@/App";
import { PROBLEMS_HEIGHT } from "@/constants";
import { stateForResolvedChecker } from "@/diagnostics/checker";
import type { Diagnostic } from "@/diagnostics/checker";
import { state } from "@/state";

import { createFixtureRepo, loadModel, makeSettleUntil, seedState } from "./helpers";

// The problems panel is a peer of the tree and the viewer, so the mouse must reach it
// The same way: a click focuses and selects without navigating the view away, and only
// A double click opens. Before this, a single click jumped straight to the file and
// Moved focus to the viewer, so a diagnostic could never be selected with the mouse.
describe("problems panel mouse", () => {
  const HEIGHT = 30;
  const WIDTH = 100;

  // Row coordinates are read back off the rendered frame rather than hardcoded, so the
  // Test does not encode the panel's row positions. The search is scoped to the panel's
  // Own box (the bottom pane, PROBLEMS_HEIGHT rows above the status bar) because the
  // Same text appears elsewhere on screen: the viewer's title row also reads `src/a.ts`
  // And the status bar echoes the finding's message, so an unscoped match lands on the
  // Wrong pane entirely.
  const problemsRowOf = (frame: string, text: string) => {
    const top = HEIGHT - 1 - PROBLEMS_HEIGHT;
    const offset = frame
      .split("\n")
      .slice(top, top + PROBLEMS_HEIGHT)
      .findIndex((line) => line.includes(text));
    return offset === -1 ? -1 : top + offset;
  };

  const openPanel = async () => {
    const repoRoot = createFixtureRepo("stet-problems-mouse-", {
      "src/a.ts": "export const a = 1;\n",
    });
    const scope = { kind: "all", ref: "HEAD" } as const;
    const model = await loadModel(repoRoot, scope);
    seedState(model, scope);

    const diagnostics: Diagnostic[] = [
      {
        checker: "diagnostics",
        column: 1,
        line: 1,
        message: "alpha finding\nhelp: try alpha",
        path: `${repoRoot}/src/a.ts`,
        severity: "error",
        source: "probe",
      },
      {
        checker: "diagnostics",
        column: 3,
        line: 2,
        message: "beta finding",
        path: `${repoRoot}/src/a.ts`,
        severity: "warning",
        source: "probe",
      },
    ];
    state.setCheckerState({
      diagnostics: stateForResolvedChecker("diagnostics", model.changed, diagnostics, repoRoot),
    });

    const harness = await testRender(() => <App />, { height: HEIGHT, width: WIDTH });
    const settleUntil = makeSettleUntil(harness);
    await settleUntil("first render", (current) => current.includes("a.ts"));
    harness.mockInput.pressKey("p");
    await harness.renderOnce();
    await settleUntil("panel open", (current) => current.includes("alpha finding"));
    return { ...harness, settleUntil };
  };

  test("a single click focuses the panel and selects the clicked diagnostic, without navigating", async () => {
    const { captureCharFrame, mockMouse, renderer, renderOnce } = await openPanel();

    try {
      // Start from the tree, so the click has to move focus itself.
      state.setFocusedPane("tree");
      await renderOnce();
      const y = problemsRowOf(captureCharFrame(), "beta finding");
      expect(y).toBeGreaterThan(0);

      await mockMouse.click(20, y);
      await renderOnce();

      expect(state.focusedPane()).toBe("problems");
      const selected = state.allProblemItems()[state.problemIndex()];
      expect(selected?.kind === "problem" && selected.summary).toBe("beta finding");
    } finally {
      renderer.destroy();
    }
  });

  test("clicking a help row selects the diagnostic it belongs to", async () => {
    const { captureCharFrame, mockMouse, renderer, renderOnce } = await openPanel();

    try {
      const y = problemsRowOf(captureCharFrame(), "try alpha");
      expect(y).toBeGreaterThan(0);

      await mockMouse.click(20, y);
      await renderOnce();

      expect(state.focusedPane()).toBe("problems");
      const selected = state.allProblemItems()[state.problemIndex()];
      expect(selected?.kind === "problem" && selected.summary).toBe("alpha finding");
    } finally {
      renderer.destroy();
    }
  });

  test("clicking panel chrome focuses the panel without moving the selection", async () => {
    const { captureCharFrame, mockMouse, renderer, renderOnce } = await openPanel();

    try {
      const y = problemsRowOf(captureCharFrame(), "beta finding");
      await mockMouse.click(20, y);
      await renderOnce();
      const selectedBefore = state.problemIndex();
      state.setFocusedPane("tree");
      await renderOnce();

      // The per-file header is chrome: it names the group, it is not an entry.
      const headerY = problemsRowOf(captureCharFrame(), "src/a.ts");
      expect(headerY).toBeGreaterThan(0);
      await mockMouse.click(20, headerY);
      await renderOnce();

      expect(state.focusedPane()).toBe("problems");
      expect(state.problemIndex()).toBe(selectedBefore);
    } finally {
      renderer.destroy();
    }
  });

  test("a double click jumps to the diagnostic and focuses the viewer", async () => {
    const { captureCharFrame, mockMouse, renderer, renderOnce } = await openPanel();

    try {
      const y = problemsRowOf(captureCharFrame(), "beta finding");
      await mockMouse.click(20, y);
      await renderOnce();
      expect(state.focusedPane()).toBe("problems");

      await mockMouse.click(20, y);
      await renderOnce();

      expect(state.focusedPane()).toBe("diff");
      expect(state.selectedPath()).toBe("src/a.ts");
    } finally {
      renderer.destroy();
    }
  });

  test("a click on chrome between two clicks on the same problem is not a double click", async () => {
    const { captureCharFrame, mockMouse, renderer, renderOnce } = await openPanel();

    try {
      const problemY = problemsRowOf(captureCharFrame(), "beta finding");
      const headerY = problemsRowOf(captureCharFrame(), "src/a.ts");
      expect(headerY).toBeGreaterThan(0);
      expect(headerY).not.toBe(problemY);

      // Problem -> header -> same problem, back to back (so the two problem clicks land
      // Inside the double-click window). The header click must break the sequence, or
      // The second problem click reads as a double and jumps the view away.
      await mockMouse.click(20, problemY);
      await mockMouse.click(20, headerY);
      await mockMouse.click(20, problemY);
      await renderOnce();

      expect(state.focusedPane()).toBe("problems");
      const selected = state.allProblemItems()[state.problemIndex()];
      expect(selected?.kind === "problem" && selected.summary).toBe("beta finding");
    } finally {
      renderer.destroy();
    }
  });
});
