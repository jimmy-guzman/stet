import { describe, expect, test } from "bun:test";

import type { ChangedFile, GitModel } from "@/git/model";
import { state } from "@/state";

function model(changed: ChangedFile[]): GitModel {
  return {
    branch: undefined,
    changed,
    changedByPath: new Map(changed.map((entry) => [entry.path, entry])),
    repoFiles: changed.map((entry) => ({ path: entry.path, symlink: false, tracked: true })),
    repoFilesKey: "key",
    repoRoot: "/repo",
    scopeKey: "all:HEAD",
  };
}

const file: ChangedFile = {
  additions: 1,
  binary: false,
  deletions: 0,
  kind: "modified",
  mtimeMs: 0,
  path: "src/foo.ts",
  stage: "unstaged",
  warnings: [],
};

describe("diagnostics off switch", () => {
  test("runChecks is inert while diagnostics are disabled", async () => {
    state.setDiagnosticsEnabled(false);
    const before = state.checkerState();

    await state.runChecks(model([file]));

    // No pending placeholder was planted and no run started.
    expect(state.checkerState()).toBe(before);
  });
});
