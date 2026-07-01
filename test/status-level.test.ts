import { afterEach, expect, test } from "bun:test";

import { emptyActivityLog, recordActivity } from "@/git/activity";
import { state } from "@/state";

// State is a global singleton; reset everything these tests write.
afterEach(() => {
  state.setNotice(undefined);
  state.setActivityLog(emptyActivityLog);
  state.setNow(Date.now());
  state.setTerminalWidth(80);
});

test("a notice surfaces its text and level on the status line", () => {
  state.notify("copied src/state.ts", "success");

  expect(state.statusRight()).toBe("copied src/state.ts");
  expect(state.statusRightLevel()).toBe("success");
});

test("a notice defaults to the info level", () => {
  state.notify("showing all files");

  expect(state.statusRight()).toBe("showing all files");
  expect(state.statusRightLevel()).toBe("info");
});

test("an error notice carries the error level for the status bar to color", () => {
  state.notify("couldn't reach the language server", "error");

  expect(state.statusRightLevel()).toBe("error");
});

// A createEffect in state re-stamps `now` to the real clock whenever activity is
// Recorded (it keeps the "Ns ago" label live), so these tests record at real time.
// Status() is a process-wide signal other suites may leave set (a long diagnostics
// Error, say), and it trails the path behind " · ", eating into the path's budget.
// So these use a generous width and a path far longer than any realistic budget:
// The path always truncates (leading "…") yet keeps ample room for the filename.
test("a long recent path is shortened from the front, keeping the filename", () => {
  state.setTerminalWidth(400);
  const deep = `src/${"components/".repeat(50)}DiffView.tsx`;
  state.setActivityLog(
    recordActivity(emptyActivityLog, [{ kind: "changed", path: deep }], Date.now()),
  );

  const line = state.statusRight();
  // Leading "…" after the label proves the head was dropped, not the filename tail.
  expect(line).toMatch(/^\d+s ago …/);
  expect(line).toContain("DiffView.tsx");
});

test("a short recent path is shown whole", () => {
  state.setTerminalWidth(300);
  state.setActivityLog(
    recordActivity(emptyActivityLog, [{ kind: "changed", path: "src/foo.ts" }], Date.now()),
  );

  // No truncation: the full path is present rather than an ellipsized fragment.
  expect(state.statusRight()).toContain("src/foo.ts");
});

test("activity older than the recency window drops off the status line", () => {
  state.setTerminalWidth(80);
  state.setActivityLog(
    recordActivity(
      emptyActivityLog,
      [{ kind: "changed", path: "src/foo.ts" }],
      Date.now() - 60_000,
    ),
  );

  const line = state.statusRight();
  expect(line).not.toContain("s ago");
  expect(line).not.toContain("src/foo.ts");
});
