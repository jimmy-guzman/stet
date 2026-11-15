import { afterEach, beforeEach } from "bun:test";

import { preloadDiffHighlighter } from "@/diff/engine";
import {
  defaultFileSupportRegistry,
  registerFileSupport,
} from "@/file-support/registry";
import { registerKeybindings } from "@/keys/registry";
import { defaultKeybindings } from "@/keys/resolve";
import { state } from "@/state";
import { setAppearance, setSelection } from "@/theme/active";
import { restoreRegistry } from "@/theme/registry";

import { sweepFixtureRepos } from "./helpers";

/**
 * Bun runs every test file in one process, so `state` (a singleton) outlives each file. A test that
 * dies mid-flight, on a timeout or a failed assertion, never reaches its own cleanup, and whatever
 * it left set poisoned every file after it, failing unrelated tests on a signal they never touched.
 * Registering here means this runs before any file's own hooks, so no test can inherit another's
 * state, however it ended. The theme, keybinding, and file-support registries and the active theme
 * signals live outside `state` (their own module state and root), where `resetState` cannot reach
 * them, so they reset here too.
 */
beforeEach(() => {
  state.resetState();
  restoreRegistry();
  setSelection(undefined);
  setAppearance("dark");
  registerKeybindings(defaultKeybindings());
  registerFileSupport(defaultFileSupportRegistry());
});

/**
 * Fixture repositories go after every test. Registering the sweep in the preload covers every test
 * file whatever order the files import the helpers module in.
 */
afterEach(sweepFixtureRepos);

/**
 * A production exit must become a test failure, never a successful early exit that lets Bun report
 * a false green without its suite summary.
 */
process.exit = (code) => {
  throw new Error(`unexpected process.exit(${String(code)}) during tests`);
};

/**
 * Warm the diff highlighter once so render tests don't race the one-time Shiki load (the first diff
 * would otherwise time out the settle helper).
 */
await preloadDiffHighlighter();
