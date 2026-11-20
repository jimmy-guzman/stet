#!/usr/bin/env bun

import { createCliRenderer } from "@opentui/core";
import { render } from "@opentui/solid";
import { Effect, Layer, ManagedRuntime } from "effect";
import { batch, createRoot } from "solid-js";

import packageJson from "../package.json";
import { App } from "./app";
import { helpText, parseCommand } from "./cli";
import { themesDir } from "./config/paths";
import { configDefaults } from "./config/schema";
import type { UserConfig } from "./config/schema";
import { Config, ConfigLive } from "./config/service";
import { resolveEditorTemplate, resolveIdeTemplate } from "./editor/reference";
import { resolveFileSupportConfig } from "./file-support/config";
import { registerFileSupport } from "./file-support/registry";
import { GitError } from "./git/errors";
import type { GitModel } from "./git/model";
import { unknownRefMessage } from "./git/repo";
import { Git, GitLive } from "./git/service";
import { defaultExpandedDirectories, expandAncestorsForPath } from "./git/tree";
import { registerKeybindings } from "./keys/registry";
import { resolveKeybindings } from "./keys/resolve";
import { logError } from "./log/terminal";
import { ProcessLive } from "./process";
import { runtime } from "./runtime";
import {
  exitAfterRestore,
  exitOnOutputFailure,
  exitOnSignals,
} from "./shutdown";
import { state } from "./state";
import { syncTerminalTitle } from "./terminal-title";
import { setAppearance, setSelection } from "./theme/active";
import { prefersMonochrome } from "./theme/mono";
import {
  hasTheme,
  loadBundledThemes,
  loadTheme,
  registerThemes,
  selectThemeName,
} from "./theme/registry";
import { probeTerminalPalette } from "./theme/system";
import { readUserThemes } from "./theme/user";
import { runUpgrade } from "./upgrade/run";

const seedSidebar = (config: UserConfig) => {
  state.setSidebarPosition(
    config.sidebar?.position ?? configDefaults.sidebar.position
  );
  state.setSidebarWidthOverride(config.sidebar?.width ?? null);
  state.setSidebarHeightOverride(config.sidebar?.height ?? null);
  state.setChangesOnly(
    config.sidebar?.changesOnly ?? configDefaults.sidebar.changesOnly
  );

  if (!(config.sidebar?.open ?? configDefaults.sidebar.open)) {
    // The one close path rather than a copy of it, so focus leaving the hidden tree is
    // Decided in the same place here as it is for `ctrl-b` and a shrink past the minimum.
    state.collapseSidebar();
  }
};

const seedSearch = (config: UserConfig) => {
  state.setSearchRegex(config.search?.regex ?? configDefaults.search.regex);
  state.setSearchCaseSensitive(
    config.search?.caseSensitive ?? configDefaults.search.caseSensitive
  );
  state.setSearchScope(config.search?.scope ?? configDefaults.search.scope);
};

try {
  const command = parseCommand(Bun.argv.slice(2));

  if (command.kind === "upgrade") {
    process.exit(
      await runUpgrade({
        currentVersion: packageJson.version,
        execPath: process.execPath,
      })
    );
  }

  const { options } = command;

  if (options.help) {
    console.log(helpText());
    process.exit(0);
  }

  if (options.version) {
    console.log(packageJson.version);
    process.exit(0);
  }

  // The startup model carries only the changed set (repoFiles fill in on the
  // Slow poll once mounted), the same shape the running app uses.
  const startup = (repoRoot: string, emptyTree: string) =>
    Effect.gen(function* startupModel() {
      const git = yield* Git;
      // The SHA HEAD points at now, pinned as the base for the `session` scope so
      // It keeps meaning "since stet launched" as the agent commits. Undefined on a
      // Repository with no commits, which is the whole unborn-HEAD signal.
      const head = yield* git.headRef(repoRoot);
      // An unborn HEAD is not a diff endpoint, and unlike every other HEAD-touching read a diff
      // Has no degraded answer, so the base is resolved before the command is built rather than
      // Tolerated after it fails. Against the empty tree every tracked file reads as added.
      // Only `HEAD` is substituted: a ref the user named still resolves on an orphan branch, where
      // Diffing against the empty tree instead would silently show the wrong base.
      const unborn = options.scope.ref === "HEAD" && head === undefined;

      const scope = unborn
        ? { ...options.scope, ref: emptyTree }
        : options.scope;

      const changed = yield* git.changedFiles(repoRoot, scope);

      return { changed, scope, sessionBase: head ?? emptyTree, unborn };
    });

  // A failed startup diff is the first thing that has actually exercised the user's ref, so it is
  // Also the only honest place to name it: `rev-parse` accepts objects `git diff` rejects (a blob)
  // And rejects arguments it takes (`main...HEAD`, an unborn `HEAD`), so gating the launch on it
  // Both blocked working invocations and let broken ones through to a wall of git usage output.
  const startupFailure = (repoRoot: string, cause: unknown) =>
    Effect.gen(function* explainStartup() {
      const fallback = cause instanceof Error ? cause.message : String(cause);

      if (!(cause instanceof GitError) || options.scope.kind === "unstaged") {
        return fallback;
      }

      const git = yield* Git;
      const diffable = yield* git.refIsDiffable(repoRoot, options.scope.ref);

      return diffable ? fallback : unknownRefMessage(options.scope.ref);
    });

  // Load the config on its own runtime, before the app runtime's first use warms
  // The diff highlighter: the active theme must be set before that warm-up reads
  // It. ConfigLive has no dependencies, so this builds nothing heavy.
  const configRuntime = ManagedRuntime.make(ConfigLive);

  const { config, issues: configIssues } = await configRuntime.runPromise(
    Config.pipe(Effect.flatMap((service) => service.load()))
  );

  await configRuntime.dispose();

  // Register the configured themes and seed the theme selection *before* the
  // Renderer enters the alt-screen, so a config-validation throw still lands on
  // The normal terminal rather than a torn-down one. These need neither the
  // Renderer nor the detected appearance; appearance is applied just below.
  const { themes, issues: themeIssues } = await readUserThemes(themesDir());
  registerThemes(themes);

  // The prefersMonochrome check (see theme/mono.ts) replaces the configured
  // Selection with the built-in monochrome pair. A later explicit pick in the
  // Theme switcher still applies: no-color.org asks that color stop being the
  // Default, not that the user be locked out of requesting it.
  const themeSelection = prefersMonochrome(process.env)
    ? { dark: "mono-dark", light: "mono-light" }
    : config.theme;

  setSelection(themeSelection);

  // Registers before the runtime builds, so the diff and icons share one startup snapshot for the
  // Full session.
  const { issues: fileSupportIssues, registry: fileSupport } =
    resolveFileSupportConfig({
      files: config.files,
      icons: config.icons?.glyphs,
    });

  registerFileSupport(fileSupport);

  const { issues: keybindingIssues, set: keybindings } = resolveKeybindings(
    config.keybindings ?? {}
  );

  registerKeybindings(keybindings);

  // Resolve the repository before the renderer enters the alt-screen, so "not a git repository"
  // Prints on the normal terminal instead of flashing an empty shell first. On its own runtime for
  // The same reason the config load has one: the first use of the app runtime builds DiffEngineLive,
  // Whose highlighter warm-up must stay behind the first paint.
  const preflightRuntime = ManagedRuntime.make(
    GitLive.pipe(Layer.provide(ProcessLive))
  );

  const { emptyTree, mainWorktreePath, repoRoot } =
    await preflightRuntime.runPromise(
      Git.pipe(Effect.flatMap((git) => git.repoContext(process.cwd())))
    );

  await preflightRuntime.dispose();

  /**
   * Created up front so the terminal's dark/light appearance is detected before the first runtime
   * use (which warms the diff highlighter), and the whole App themes to match. Detection is a
   * bounded terminal query; a terminal that does not answer within the timeout falls back to dark.
   * The same renderer is reused for the first paint below, so detection costs no extra frame.
   * `autoFocus` is off because OpenTUI's focus-the-element-under-the-pointer on mouse-down would
   * draw the terminal cursor in a clicked renderable (a tab, say); stet drives focus through its own
   * keymap, and overlay inputs focus via their explicit `focused` prop. stet owns process shutdown
   * (`exitOnSignals`, registered before setup so it covers it), so the renderer installs no signal
   * handlers of its own: its defaults only destroy, and a listener replaces a signal's default
   * termination, so the git poll kept a destroyed stet running.
   */
  const pendingRenderer = createCliRenderer({
    autoFocus: false,
    exitOnCtrlC: false,
    exitSignals: [],
  });

  exitOnSignals(pendingRenderer);

  const renderer = await pendingRenderer;

  // The appearance and the terminal palette (the `system` theme) are two bounded queries, asked
  // Together so a terminal that answers neither costs one timeout, not two.
  const [mode] = await Promise.all([
    renderer.waitForThemeMode(100),
    probeTerminalPalette(renderer),
  ]);

  const appearance = mode ?? "dark";

  void exitOnOutputFailure(renderer);

  /**
   * An uncaught error or rejection restores the terminal and exits 1 with its message, so a crash
   * cannot leave the alt-screen buffer active and the next launch blank.
   */
  const crash = (cause: unknown) => {
    void exitAfterRestore(renderer, 1, {
      level: "error",
      text: cause instanceof Error ? cause.message : String(cause),
    });
  };

  process.on("uncaughtException", crash);
  process.on("unhandledRejection", crash);

  // Apply the detected appearance and validate the active theme name. Both need
  // The renderer's appearance and are non-throwing, so running them after the
  // Alt-screen is entered leaves no window for a blank-on-error. Selection +
  // Appearance together feed the active theme before the first runtime use warms
  // The highlighter; the renderer's theme_mode event updates appearance live.
  setAppearance(appearance);
  const activeName = selectThemeName(themeSelection, appearance);

  if (hasTheme(activeName)) {
    // A bundled theme imports on demand; the active one lands before the first paint.
    await loadTheme(activeName);
  } else {
    themeIssues.push(`theme "${activeName}" not found; using the default`);
  }

  // The CLI- and config-derived state needs no git, so seed it before the first
  // Paint. A CLI flag wins over its config key for the run it was passed on (the
  // Off-flags only ever turn a feature off, so flag-or-config composes with ||).
  batch(() => {
    state.setScope(options.scope);
    state.setCliBaseRef(options.scope.ref);
    state.setIconsEnabled(
      options.icons && (config.icons?.enabled ?? configDefaults.icons.enabled)
    );
    state.setOverflow(
      options.overflow === "wrap" ||
        (config.viewer?.wrap ?? configDefaults.viewer.wrap)
        ? "wrap"
        : "scroll"
    );
    state.setEditorTemplate(
      resolveEditorTemplate(options.editor ?? config.editor)
    );
    state.setIdeTemplate(resolveIdeTemplate(options.ide ?? config.ide));
    // The raw flags, so ctrl-s can persist a literal --editor/--ide (never the
    // Resolved template, which folds in environment fallbacks).
    state.setEditorFlag(options.editor);
    state.setIdeFlag(options.ide);
    seedSidebar(config);
    seedSearch(config);
    // Seed the real terminal size before the first paint. Without this, the shell
    // Paints once at the default 24 rows (a 20-row tree viewport) before App's terminal
    // Dimensions effect supplies the true size, so a tree that fits the real pane
    // Briefly overflows the too-short default and flashes a scrollbar.
    state.setTerminalWidth(renderer.width);
    state.setTerminalHeight(renderer.height);
  });

  // Paint the shell immediately from the empty model — every effect guards on the
  // Empty root / undefined selection — so a large repo shows the UI at once
  // Instead of a blank alt-screen for the whole git load. The model loads in the
  // Background and seeds when it resolves, the same instant-then-fill shape a
  // Worktree switch already uses. The repository itself already resolved in the
  // Preflight, so a failure here is a repository git can no longer read; it
  // Restores the terminal before exiting, the alt-screen now being entered.
  void render(() => <App />, renderer);

  // The rest of the bundled themes, for the switcher, once the first paint is out.
  void loadBundledThemes();

  createRoot(() => {
    syncTerminalTitle(renderer);
  });

  // Check for a newer release in the background, independent of the git load, so it neither gates
  // Nor is gated by it. A hit surfaces on the way out via the quit notice.
  if (config.update?.check ?? configDefaults.update.check) {
    void state.checkForUpdate(packageJson.version);
  }

  // The startup diff already failed, so a failure to explain it falls back to the raw message.
  const explainFailure = async (cause: unknown) => {
    try {
      return await runtime.runPromise(startupFailure(repoRoot, cause));
    } catch {
      return cause instanceof Error ? cause.message : String(cause);
    }
  };

  const loadModel = async () => {
    try {
      const { changed, scope, sessionBase, unborn } = await runtime.runPromise(
        startup(repoRoot, emptyTree)
      );

      const model: GitModel = {
        repoRoot,
        ...changed,
        repoFiles: [],
        repoFilesKey: "",
      };

      const initialSelectedPath =
        model.changed[0]?.path ?? model.repoFiles[0]?.path;

      const baseExpanded = defaultExpandedDirectories(
        model.changed.map((file) => file.path)
      );

      const initialExpanded =
        initialSelectedPath === undefined
          ? baseExpanded
          : expandAncestorsForPath(baseExpanded, initialSelectedPath);

      batch(() => {
        state.setHeadUnborn(unborn);

        // The shell painted before this resolved, so the user may already have picked a scope from
        // The menu; only the untouched CLI scope is re-pointed at the resolved base.
        if (
          state.scope().kind === options.scope.kind &&
          state.scope().ref === options.scope.ref
        ) {
          state.setScope(scope);
        }

        state.setSessionBase(sessionBase);
        state.setGitModel(model);
        state.setRepoRoot(model.repoRoot);
        state.setMainWorktreePath(mainWorktreePath);
        state.setEmptyTree(emptyTree);
        state.setLastChange(Date.now());
        state.seedNav(initialSelectedPath);
        state.focusTreeNode(
          initialSelectedPath === undefined ? "" : `file:${initialSelectedPath}`
        );
        state.setExpandedDirectories(initialExpanded);
      });

      // A bad config never blocks startup; the first issue surfaces as a notice.
      const issues = [
        ...configIssues,
        ...themeIssues,
        ...fileSupportIssues,
        ...keybindingIssues,
      ];

      if (issues.length > 0) {
        state.notify(issues[0] ?? "config has issues");
      }
    } catch (error) {
      await exitAfterRestore(renderer, 1, {
        level: "error",
        text: await explainFailure(error),
      });
    }
  };

  void loadModel();
} catch (error) {
  logError(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
