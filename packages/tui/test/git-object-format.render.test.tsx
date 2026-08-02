import { expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { testRender } from "@opentui/solid";
import { Effect, Layer } from "effect";

import { App } from "@/App";
import { Git, GitLive } from "@/git/service";
import { ProcessLive } from "@/process";
import { state } from "@/state";

import { createFixtureRepo, loadModel, makeSettleUntil, runGit, seedState } from "./helpers";

// `git-object-format.test.ts` drives `Git` directly, so every case there would still pass if a
// Substitution site inside `state` went back to naming a SHA-1 constant. These seed the app the way
// `main.tsx` does and assert the surface a SHA-256 user actually sees.

const sha256 = { commit: false, objectFormat: "sha256" };

const repoContext = (repoRoot: string) =>
  Effect.runPromise(
    Git.pipe(
      Effect.flatMap((git) => git.repoContext(repoRoot)),
      Effect.provide(GitLive.pipe(Layer.provide(ProcessLive))),
    ),
  );

// The tree lists the repository's files, the header names the base instead of printing 64
// Characters of sha into it, and `baseRef` hands the same base to a scope resolved after the seed.
test("the app opens a commitless SHA-256 repository against its own empty tree", async () => {
  const repo = createFixtureRepo("git-sha256-render-", { "a.txt": "one\ntwo\n" }, sha256);
  const { emptyTree } = await repoContext(repo);
  const scope = { kind: "all", ref: emptyTree } as const;

  seedState(await loadModel(repo, scope), scope, emptyTree);
  state.setCliBaseRef("HEAD");
  state.setHeadUnborn(true);

  const { renderer, renderOnce, captureCharFrame } = await testRender(() => <App />, {
    height: 24,
    width: 100,
  });
  try {
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });
    const frame = await settleUntil("the tree lists the file", (current) =>
      current.includes("a.txt"),
    );

    expect(frame).toContain("uncommitted vs no commits yet");
    expect(frame).not.toContain(emptyTree.slice(0, 12));

    state.selectScope("staged");
    expect(state.scope()).toEqual({ kind: "staged", ref: emptyTree });
  } finally {
    renderer.destroy();
  }
});

// A commit gives HEAD a meaning, and the drain has to return the base to it in a SHA-256 repository
// Exactly as it does in a SHA-1 one.
test("the base returns to HEAD once a SHA-256 repository has its first commit", async () => {
  const repo = createFixtureRepo("git-sha256-first-", { "a.txt": "one\n" }, sha256);
  const { emptyTree } = await repoContext(repo);
  const scope = { kind: "all", ref: emptyTree } as const;

  seedState(await loadModel(repo, scope), scope, emptyTree);
  state.setCliBaseRef("HEAD");
  state.setHeadUnborn(true);

  const { renderer, renderOnce, captureCharFrame } = await testRender(() => <App />, {
    height: 24,
    width: 100,
  });
  try {
    const settleUntil = makeSettleUntil({ captureCharFrame, renderOnce });
    await settleUntil("the empty repository renders", (frame) => frame.includes("no commits yet"));

    writeFileSync(join(repo, "b.txt"), "two\n");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "-m", "initial"]);

    const frame = await settleUntil(
      "the base re-points off the empty tree",
      (current) => current.includes("uncommitted vs HEAD"),
      1,
      600,
    );
    expect(frame).not.toContain("no commits yet");
  } finally {
    renderer.destroy();
  }
}, 20_000);
