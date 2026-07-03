import { afterEach, expect, test } from "bun:test";

import { batch } from "solid-js";

import type { Commit } from "@/git/log";
import { state } from "@/state";

const commit = (n: number, subject: string): Commit => ({
  author: "Jimmy",
  authorTime: 1_700_000_000 - n,
  parent: `p${n}`,
  sha: `sha${n}`,
  shortSha: `sha${n}`,
  subject,
});

// Newest-first: index 0 is the newest, higher index is older.
const three = [commit(0, "newest"), commit(1, "middle"), commit(2, "oldest")];

afterEach(() => {
  batch(() => {
    state.setCommits([]);
    state.setScope({ kind: "all", ref: "HEAD" });
  });
});

test("selectCommit pins a range scope of the commit's parent against its sha", () => {
  state.setCommits(three);
  state.selectCommit(1);

  expect(state.scope()).toEqual({ headRef: "sha1", kind: "commit", ref: "p1" });
});

test("commitScopeLabel is the active commit's subject", () => {
  state.setCommits(three);
  state.selectCommit(0);
  expect(state.commitScopeLabel()).toBe("newest");
});

test("commitScopeLabel follows the pinned commit after the list reloads", () => {
  state.setCommits(three);
  state.selectCommit(1); // The "middle" commit (sha1)

  // A newer commit lands and the drill-down reloads: the snapshot shifts down.
  state.setCommits([{ ...commit(0, "brand new"), sha: "shaNEW" }, ...three]);

  // The label still names the pinned commit (sha1), not whatever now sits at index 1.
  expect(state.commitScopeLabel()).toBe("middle");
});

test("selecting out of range is a no-op", () => {
  state.setCommits(three);
  state.selectCommit(9);
  expect(state.scope()).toEqual({ kind: "all", ref: "HEAD" });
});
