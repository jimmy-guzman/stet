import { afterEach, expect, test } from "bun:test";

import { emptyActivityLog, recordActivity } from "@/git/activity";
import { state } from "@/state";

// State is a global singleton; reset everything these tests write.
afterEach(() => {
  state.setNotice(undefined);
  state.setActivityLog(emptyActivityLog);
  state.setNow(Date.now());
  state.setTerminalWidth(80);
  state.setProvisioningLanguages(new Set<string>());
});

test("a downloading language server surfaces a live installing status", () => {
  state.setProvisioningLanguages(new Set(["typescript"]));

  expect(state.statusRight()).toContain("installing typescript server");
  expect(state.statusRightLevel()).toBe("info");
});

test("a second downloading server collapses to a count", () => {
  state.setProvisioningLanguages(new Set(["typescript", "oxlint"]));

  expect(state.statusRight()).toContain("installing 2 servers");
});

test("the installing status clears once no server is downloading", () => {
  state.setProvisioningLanguages(new Set(["typescript"]));
  state.setProvisioningLanguages(new Set<string>());

  expect(state.statusRight()).not.toContain("installing");
});

test("the installing status keeps its verb when the pane is narrow", () => {
  state.setTerminalWidth(40);
  state.setProvisioningLanguages(new Set(["typescript"]));

  // Truncates from the tail (like checking…), but the leading verb survives so the line still reads.
  expect(state.statusRight().startsWith("installing")).toBe(true);
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
// Recorded (it keeps the recency clock live), so these tests record at real time.
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
  // A leading "…" proves the head was dropped, not the filename tail.
  expect(line).toMatch(/^…/);
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

  expect(state.statusRight()).not.toContain("src/foo.ts");
});

// The status bar shows the recent changed file (path) apart from the leveled status
// (message), so it can tint the path and color the message independently. These lock
// The pieces the two renderers consume.
test("the recent changed file is exposed as a path, separate from the leveled status", () => {
  state.setTerminalWidth(300);
  state.setActivityLog(
    recordActivity(emptyActivityLog, [{ kind: "changed", path: "src/foo.ts" }], Date.now()),
  );
  state.setProvisioningLanguages(new Set(["typescript"]));

  expect(state.statusRightPath()).toBe("src/foo.ts");
  expect(state.statusRightMessage()).toBe("installing typescript server…");
  // The plain-text projection still joins them with the divider the bar renders.
  expect(state.statusRight()).toBe("src/foo.ts · installing typescript server…");
});

test("a narrow bar caps the status message so it can't overflow past the path and dot", () => {
  state.setTerminalWidth(40);
  state.setActivityLog(
    recordActivity(emptyActivityLog, [{ kind: "changed", path: "src/foo.ts" }], Date.now()),
  );
  state.setProvisioningLanguages(new Set(["typescript"]));

  // At a narrow width the full "installing typescript server…" cannot sit beside the path
  // And its dot, so it is truncated rather than spilling into the left hint.
  expect(state.statusRightMessage().length).toBeLessThan("installing typescript server…".length);
});

test("a leveled message with no recent activity has no path", () => {
  state.notify("copied src/state.ts", "success");

  expect(state.statusRightPath()).toBe("");
  expect(state.statusRightMessage()).toBe("copied src/state.ts");
  // No changed file backs it, so there is no recency timestamp for the dot or the fade.
  expect(state.statusRightRecencyAt()).toBeUndefined();
});

// The recent path exposes its activity timestamp so the bar can fade the tint and draw
// The recency dot off it, then drops it once the file ages past the 30s window.
test("the recent path exposes its recency timestamp, then drops it once aged out", () => {
  state.setTerminalWidth(300);

  const at = Date.now();
  state.setActivityLog(
    recordActivity(emptyActivityLog, [{ kind: "changed", path: "src/foo.ts" }], at),
  );
  expect(state.statusRightRecencyAt()).toBe(at);

  state.setActivityLog(
    recordActivity(
      emptyActivityLog,
      [{ kind: "changed", path: "src/foo.ts" }],
      Date.now() - 60_000,
    ),
  );
  expect(state.statusRightRecencyAt()).toBeUndefined();
});
