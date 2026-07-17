import { expect, test } from "bun:test";

import { emptyActivityLog, recordActivity } from "@/git/activity";
import { state } from "@/state";

test("a downloading language server surfaces background progress", () => {
  state.setProvisioningLanguages(new Set(["typescript"]));

  expect(state.statusBarModel()).toMatchObject({
    content: {
      category: "background-progress",
      kind: "ambient",
      level: "info",
      message: "installing typescript server…",
    },
    layout: "split",
  });
});

test("a second downloading server collapses to a count", () => {
  state.setProvisioningLanguages(new Set(["typescript", "oxlint"]));

  expect(state.statusBarModel().content).toMatchObject({ message: "installing 2 servers…" });
});

test("the installing status clears once no server is downloading", () => {
  state.setProvisioningLanguages(new Set(["typescript"]));
  state.setProvisioningLanguages(new Set<string>());

  const content = state.statusBarModel().content;
  expect(content?.kind === "ambient" ? content.message : "").not.toContain("installing");
});

test("background progress takes over instead of truncating beside the generic hint", () => {
  state.setTerminalWidth(40);
  state.setProvisioningLanguages(new Set(["typescript"]));

  expect(state.statusBarModel()).toMatchObject({
    content: { message: "installing typescript server…" },
    layout: "full",
  });
});

test("a notice surfaces its text and level as a full-row notification", () => {
  state.notify("copied src/state.ts", "success");

  expect(state.statusBarModel()).toMatchObject({
    content: {
      category: "notification",
      kind: "message",
      level: "success",
      message: "copied src/state.ts",
    },
    layout: "full",
  });
});

test("a notice defaults to the info level", () => {
  state.notify("showing all files");

  expect(state.statusBarModel().content).toMatchObject({
    category: "notification",
    level: "info",
    message: "showing all files",
  });
});

test("an error notice carries the error level", () => {
  state.notify("couldn't reach the language server", "error");

  expect(state.statusBarModel().content).toMatchObject({ level: "error" });
});

test("a long recent path takes over and is shortened from the front", () => {
  state.setTerminalWidth(400);
  const deep = `src/${"components/".repeat(50)}DiffView.tsx`;
  state.setActivityLog(
    recordActivity(emptyActivityLog, [{ kind: "changed", path: deep }], Date.now()),
  );

  const model = state.statusBarModel();
  expect(model.layout).toBe("full");
  if (model.layout !== "full" || model.content.kind !== "ambient") {
    throw new Error("expected ambient activity");
  }
  expect(model.content.activity?.path).toMatch(/^…/);
  expect(model.content.activity?.path).toContain("DiffView.tsx");
});

test("a short recent path stays beside the generic hint", () => {
  state.setTerminalWidth(300);
  state.setActivityLog(
    recordActivity(emptyActivityLog, [{ kind: "changed", path: "src/foo.ts" }], Date.now()),
  );

  expect(state.statusBarModel()).toMatchObject({
    content: { activity: { path: "src/foo.ts" }, category: "ambient" },
    layout: "split",
  });
});

test("activity older than the recency window drops off the status line", () => {
  state.setActivityLog(
    recordActivity(
      emptyActivityLog,
      [{ kind: "changed", path: "src/foo.ts" }],
      Date.now() - 60_000,
    ),
  );

  expect(state.statusBarModel().content).toBeUndefined();
});

test("the recent file stays separate from a leveled background message", () => {
  state.setTerminalWidth(300);
  state.setActivityLog(
    recordActivity(emptyActivityLog, [{ kind: "changed", path: "src/foo.ts" }], Date.now()),
  );
  state.setProvisioningLanguages(new Set(["typescript"]));

  expect(state.statusBarModel()).toMatchObject({
    content: {
      activity: { path: "src/foo.ts" },
      category: "background-progress",
      level: "info",
      message: "installing typescript server…",
    },
    layout: "split",
  });
});

test("a narrow ambient takeover preserves the message before the path", () => {
  state.setTerminalWidth(40);
  state.setActivityLog(
    recordActivity(emptyActivityLog, [{ kind: "changed", path: "src/foo.ts" }], Date.now()),
  );
  state.setProvisioningLanguages(new Set(["typescript"]));

  const model = state.statusBarModel();
  expect(model.layout).toBe("full");
  expect(model.content).toMatchObject({ message: "installing typescript server…" });
});

test("a leveled notification carries no ambient activity", () => {
  state.notify("copied src/state.ts", "success");

  expect(state.statusBarModel().content).toMatchObject({
    category: "notification",
    message: "copied src/state.ts",
  });
});

test("the recent activity timestamp drops once it ages out", () => {
  state.setTerminalWidth(300);
  const at = Date.now();
  state.setActivityLog(
    recordActivity(emptyActivityLog, [{ kind: "changed", path: "src/foo.ts" }], at),
  );

  const recent = state.statusBarModel().content;
  expect(recent?.kind === "ambient" ? recent.activity?.at : undefined).toBe(at);

  state.setActivityLog(
    recordActivity(
      emptyActivityLog,
      [{ kind: "changed", path: "src/foo.ts" }],
      Date.now() - 60_000,
    ),
  );
  expect(state.statusBarModel().content).toBeUndefined();
});
