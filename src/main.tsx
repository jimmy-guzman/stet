#!/usr/bin/env bun

import { render } from "@opentui/solid";
import { Effect } from "effect";
import { batch } from "solid-js";

import packageJson from "../package.json";
import { App } from "./App";
import { helpText, parseArgs } from "./cli";
import { initialCheckerState } from "./diagnostics/checker";
import type { GitModel } from "./git/model";
import { Git } from "./git/service";
import { defaultExpandedDirectories, expandAncestorsForPath } from "./git/tree";
import { Process } from "./process";
import { runtime } from "./runtime";
import { state } from "./state";

try {
  const options = parseArgs(Bun.argv.slice(2));

  if (options.help) {
    console.log(helpText());
    process.exit(0);
  }

  if (options.version) {
    console.log(packageJson.version);
    process.exit(0);
  }

  // The provisioner reads this env var; set it before any check runs the runtime.
  if (!options.lspDownload) {
    process.env.SIDEYE_NO_LSP_DOWNLOAD = "1";
  }

  // The startup model carries only the changed set (repoFiles fill in on the
  // Slow poll once mounted), the same shape the running app uses.
  const startup = Effect.gen(function* startupModel() {
    const subprocess = yield* Process;
    const git = yield* Git;
    // One rev-parse yields both the repo root and the common dir. The common dir
    // Is <main>/.git for any worktree, so stripping /.git gives the main worktree
    // — the recovery target if this worktree is later deleted. It lives outside a
    // Linked worktree's tree, so it survives that deletion.
    const lines = (yield* subprocess.run(
      ["git", "rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"],
      process.cwd(),
    )).stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    const repoRoot = lines[0] ?? "";
    const commonDir = lines[1] ?? "";
    const suffix = "/.git";
    const mainWorktreePath = commonDir.endsWith(suffix)
      ? commonDir.slice(0, -suffix.length)
      : repoRoot;
    const changed = yield* git.changedFiles(repoRoot, options.scope);
    return { changed, mainWorktreePath, repoRoot };
  });

  const { changed, mainWorktreePath, repoRoot } = await runtime.runPromise(startup);

  // oxlint-disable-next-line no-magic-numbers -- one-time startup model assembly
  const model: GitModel = { repoRoot, ...changed, repoFiles: [], repoFilesKey: "" };
  const initialSelectedPath = model.changed[0]?.path ?? model.repoFiles[0]?.path;
  const baseExpanded = defaultExpandedDirectories(model.changed.map((file) => file.path));
  const initialExpanded =
    initialSelectedPath === undefined
      ? baseExpanded
      : expandAncestorsForPath(baseExpanded, initialSelectedPath);

  batch(() => {
    state.setScope(options.scope);
    state.setIconsEnabled(options.icons);
    state.setOverflow(options.overflow);
    state.setGitModel(model);
    state.setRepoRoot(model.repoRoot);
    state.setMainWorktreePath(mainWorktreePath);
    state.setLastChange(Date.now());
    state.setSelectedPath(initialSelectedPath);
    state.setFocusedNodeId(initialSelectedPath === undefined ? "" : `file:${initialSelectedPath}`);
    state.setExpandedDirectories(initialExpanded);
    state.setCheckerState(initialCheckerState(model.changed));
  });
  void state.runChecks(model);

  // OpenTUI's exitOnCtrlC only calls renderer.destroy(), never process.exit, so
  // The background git poll keeps the event loop alive and the process lags
  // Before exiting. Route ctrl-c through our own quit() (in the keymap) instead.
  void render(() => <App />, { exitOnCtrlC: false });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
