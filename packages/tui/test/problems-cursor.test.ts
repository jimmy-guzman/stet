import { expect, test } from "bun:test";

import type { CheckerState } from "@/diagnostics/checker";
import { isNavigableProblemItem } from "@/diagnostics/problems";
import { state } from "@/state";

// The panel marks its cursor with a row highlight and nothing else, and only a finding row can
// Carry it. So a `problemIndex` parked on a header or a spacer is a panel with no cursor at all,
// Which is what these cases rule out however the list came to be that way.
const checkerState = (files: Record<string, string[]>): CheckerState => ({
  diagnostics: new Map(
    Object.entries(files).map(([path, messages]) => [
      path,
      {
        count: messages.length,
        diagnostics: messages.map((message, index) => ({
          checker: "diagnostics" as const,
          line: index + 1,
          message,
          path,
          severity: "error" as const,
        })),
        status: "findings" as const,
      },
    ]),
  ),
});

const cursorRow = () => state.allProblemItems()[state.problemIndex()];

test("a panel seeded open from config lands its cursor on a finding, not the file header", () => {
  // What `main.tsx` does for `problems.open: true`: it opens the panel without taking focus, so
  // Nothing ever seeded the cursor and item 0 is the `src/a.ts` header.
  state.setProblemsOpen(true);

  state.setCheckerState(checkerState({ "src/a.ts": ["boom"] }));

  expect(cursorRow()?.kind).toBe("problem");
});

test("the cursor re-homes when the findings it sat on disappear", () => {
  state.setProblemsOpen(true);
  state.setCheckerState(checkerState({ "src/a.ts": ["x", "y"], "src/b.ts": ["z"] }));
  state.setProblemIndex(state.allProblemItems().length - 1);
  expect(cursorRow()?.kind).toBe("problem");

  // A background re-check resolves src/b.ts, so its header and finding vanish from under the
  // Cursor and the index now points past the end of the list.
  state.setCheckerState(checkerState({ "src/a.ts": ["x"] }));

  const landed = cursorRow();
  expect(landed !== undefined && isNavigableProblemItem(landed)).toBe(true);
});

test("re-homing goes backward, so a shrink lands near where the cursor was", () => {
  state.setProblemsOpen(true);
  state.setCheckerState(checkerState({ "src/a.ts": ["first", "second"], "src/b.ts": ["third"] }));
  state.setProblemIndex(state.allProblemItems().length - 1);

  state.setCheckerState(checkerState({ "src/a.ts": ["first", "second"] }));

  // The nearest finding at or before where it was, which is a's last, rather than the top.
  const landed = cursorRow();
  expect(landed?.kind === "problem" && landed.problem.message).toBe("second");
});

test("a settled cursor is left alone when a re-check reports the same findings", () => {
  state.setProblemsOpen(true);
  state.setCheckerState(checkerState({ "src/a.ts": ["x", "y"] }));
  state.setProblemIndex(state.allProblemItems().length - 1);
  const before = state.problemIndex();

  state.setCheckerState(checkerState({ "src/a.ts": ["x", "y"] }));

  expect(state.problemIndex()).toBe(before);
});
