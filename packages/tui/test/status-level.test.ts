import { expect, test } from "bun:test";

import { emptyActivityLog, recordActivity } from "@/git/activity";
import { state } from "@/state";

// The pure ladder and its fitting are covered in status-model.test.ts. These cover the seam: that
// Each live signal reaches the input it is supposed to feed, and that the bar reflects it.

test("a downloading language server surfaces background progress", () => {
  state.setProvisioningLanguages(new Set(["typescript"]));

  expect(state.statusBarModel()).toMatchObject({
    category: "background-progress",
    kind: "message",
    level: "info",
    message: "installing typescript server…",
  });
});

test("a second downloading server collapses to a count", () => {
  state.setProvisioningLanguages(new Set(["typescript", "oxlint"]));

  expect(state.statusBarModel()).toMatchObject({ message: "installing 2 servers…" });
});

test("the installing status clears once no server is downloading", () => {
  state.setProvisioningLanguages(new Set(["typescript"]));
  state.setProvisioningLanguages(new Set<string>());

  expect(state.statusBarModel()).toMatchObject({ kind: "guidance" });
});

test("a notice surfaces its text and level as a full-row notification", () => {
  state.notify("copied src/state.ts", "success");

  expect(state.statusBarModel()).toMatchObject({
    category: "notification",
    kind: "message",
    level: "success",
    message: "copied src/state.ts",
  });
});

test("a notice defaults to the info level", () => {
  state.notify("showing all files");

  expect(state.statusBarModel()).toMatchObject({
    category: "notification",
    level: "info",
    message: "showing all files",
  });
});

test("an error notice carries the error level", () => {
  state.notify("couldn't reach the language server", "error");

  expect(state.statusBarModel()).toMatchObject({ level: "error" });
});

test("an idle bar shows guidance", () => {
  expect(state.statusBarModel()).toMatchObject({ kind: "guidance", text: "? help · q quit" });
});

test("the find modes carry their own guidance", () => {
  state.setFindOpen(true);
  expect(state.statusBarModel()).toMatchObject({ text: "enter find · esc cancel" });

  // Committing the find closes the input and leaves the matches navigable.
  state.setFindOpen(false);
  state.setFindActive(true);
  expect(state.statusBarModel()).toMatchObject({ text: "n/N next/prev · esc clear" });
});

test("a recent changed file surfaces as ambient activity", () => {
  state.setTerminalWidth(300);
  state.setActivityLog(
    recordActivity(emptyActivityLog, [{ kind: "changed", path: "src/foo.ts" }], Date.now()),
  );

  expect(state.statusBarModel()).toMatchObject({
    activity: { path: "src/foo.ts" },
    category: "ambient",
  });
});

test("a long recent path is shortened from the front, keeping the filename", () => {
  state.setTerminalWidth(400);
  const deep = `src/${"components/".repeat(50)}DiffView.tsx`;
  state.setActivityLog(
    recordActivity(emptyActivityLog, [{ kind: "changed", path: deep }], Date.now()),
  );

  const model = state.statusBarModel();
  if (model.kind !== "ambient") {
    throw new Error("expected ambient activity");
  }
  expect(model.activity.path).toStartWith("…");
  expect(model.activity.path).toContain("DiffView.tsx");
});

test("activity older than the recency window drops off the status line", () => {
  state.setActivityLog(
    recordActivity(
      emptyActivityLog,
      [{ kind: "changed", path: "src/foo.ts" }],
      Date.now() - 60_000,
    ),
  );

  expect(state.statusBarModel()).toMatchObject({ kind: "guidance" });
});

test("background progress outranks a recent changed file", () => {
  state.setTerminalWidth(300);
  state.setActivityLog(
    recordActivity(emptyActivityLog, [{ kind: "changed", path: "src/foo.ts" }], Date.now()),
  );
  state.setProvisioningLanguages(new Set(["typescript"]));

  // One row, one tenant: the install is what the user is waiting on, so the changed file waits.
  expect(state.statusBarModel()).toMatchObject({
    category: "background-progress",
    message: "installing typescript server…",
  });
});

test("the recent activity timestamp reaches the bar, then drops once it ages out", () => {
  state.setTerminalWidth(300);
  const at = Date.now();
  state.setActivityLog(
    recordActivity(emptyActivityLog, [{ kind: "changed", path: "src/foo.ts" }], at),
  );

  expect(state.statusBarModel()).toMatchObject({ activity: { at } });

  state.setActivityLog(
    recordActivity(
      emptyActivityLog,
      [{ kind: "changed", path: "src/foo.ts" }],
      Date.now() - 60_000,
    ),
  );
  expect(state.statusBarModel()).toMatchObject({ kind: "guidance" });
});

// A worktree that vanished before the switch is the one alert path reachable without a repo, so it
// Is how the wiring from `raise` through to the rendered row gets covered here.
test("a missing worktree raises a persistent alert that outlives its keystroke", () => {
  // The path check is synchronous and bails before any git, so the alert is already up.
  void state.switchWorktree({
    bare: false,
    detached: false,
    head: "",
    locked: false,
    path: "/nowhere/does-not-exist",
    prunable: false,
  });

  expect(state.statusBarModel()).toMatchObject({
    category: "persistent-alert",
    level: "warning",
    message: "missing worktree: /nowhere/does-not-exist",
  });
});
