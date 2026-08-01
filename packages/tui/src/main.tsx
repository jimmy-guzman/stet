#!/usr/bin/env bun

import { createCliRenderer } from "@opentui/core";
import { render } from "@opentui/solid";
import { Effect, Layer, ManagedRuntime } from "effect";
import { batch } from "solid-js";

import packageJson from "../package.json";
import { App } from "./App";
import { helpText, parseCommand } from "./cli";
import { configDefaults } from "./config/schema";
import { Config, ConfigLive } from "./config/service";
import { initialCheckerState } from "./diagnostics/checker";
import { resolveSchemas, yamlSchemaSettings } from "./diagnostics/schemas";
import { registerServers, resolveServers } from "./diagnostics/servers";
import { resolveEditorTemplate, resolveIdeTemplate } from "./editor/reference";
import { resolveFileSupportConfig } from "./file-support/config";
import { registerFileSupport } from "./file-support/registry";
import { GitError } from "./git/errors";
import { EMPTY_TREE_SHA } from "./git/model";
import type { GitModel } from "./git/model";
import { unknownRefMessage } from "./git/repo";
import { Git, GitLive } from "./git/service";
import { defaultExpandedDirectories, expandAncestorsForPath } from "./git/tree";
import { registerKeybindings } from "./keys/registry";
import { resolveKeybindings } from "./keys/resolve";
import { logError } from "./log/terminal";
import { ProcessLive } from "./process";
import { runtime } from "./runtime";
import { state } from "./state";
import { setAppearance, setSelection } from "./theme/active";
import { prefersMonochrome } from "./theme/mono";
import { hasTheme, registerThemes, resolveThemes, selectThemeName } from "./theme/registry";
import { runUpgrade } from "./upgrade/run";

try {
  const command = parseCommand(Bun.argv.slice(2));

  if (command.kind === "upgrade") {
    process.exit(
      await runUpgrade({ currentVersion: packageJson.version, execPath: process.execPath }),
    );
  }

  const options = command.options;

  if (options.help) {
    console.log(helpText());
    process.exit(0);
  }

  if (options.version) {
    console.log(packageJson.version);
    process.exit(0);
  }

  // Everything git has to answer before there is a UI to report a failure in: which repository
  // This is, and whether a ref the user named exists. Both are O(1) reads, so they cost the first
  // Paint nothing measurable, and their failures print on the normal terminal.
  const preflight = (cwd: string) =>
    Effect.gen(function* repoPreflight() {
      const git = yield* Git;
      const context = yield* git.repoContext(cwd);
      if (options.ref !== undefined && !(yield* git.verifyRef(context.repoRoot, options.ref))) {
        return yield* new GitError({ message: unknownRefMessage(options.ref) });
      }
      return context;
    });

  // The startup model carries only the changed set (repoFiles fill in on the
  // Slow poll once mounted), the same shape the running app uses.
  const startup = (repoRoot: string) =>
    Effect.gen(function* startupModel() {
      const git = yield* Git;
      // The SHA HEAD points at now, pinned as the base for the `session` scope so
      // It keeps meaning "since stet launched" as the agent commits. It is also the
      // Empty tree on a repository with no commits, which is the whole unborn-HEAD signal.
      const sessionBase = yield* git.headRef(repoRoot);
      // An unborn HEAD is not a diff endpoint, and unlike every other HEAD-touching read a diff
      // Has no degraded answer, so the base is resolved before the command is built rather than
      // Tolerated after it fails. Against the empty tree every tracked file reads as added.
      const unborn = sessionBase === EMPTY_TREE_SHA;
      const scope = unborn ? { ...options.scope, ref: EMPTY_TREE_SHA } : options.scope;
      const changed = yield* git.changedFiles(repoRoot, scope);
      return { changed, scope, sessionBase, unborn };
    });

  // Load the config on its own runtime, before the app runtime's first use warms
  // The diff highlighter: the active theme must be set before that warm-up reads
  // It. ConfigLive has no dependencies, so this builds nothing heavy.
  const configRuntime = ManagedRuntime.make(ConfigLive);
  const { config, issues: configIssues } = await configRuntime.runPromise(
    Config.pipe(Effect.flatMap((service) => service.load())),
  );
  await configRuntime.dispose();

  const diagnosticsEnabled = config.diagnostics?.enabled ?? configDefaults.diagnostics.enabled;

  // The provisioner reads this env var; set it before any check runs the runtime.
  // The flag wins over config, and both only ever turn downloads off.
  if (
    !(options.lspDownload && (config.diagnostics?.download ?? configDefaults.diagnostics.download))
  ) {
    process.env.STET_NO_LSP_DOWNLOAD = "1";
  }

  // Register the configured themes and seed the theme selection *before* the
  // Renderer enters the alt-screen, so a config-validation throw still lands on
  // The normal terminal rather than a torn-down one. These need neither the
  // Renderer nor the detected appearance; appearance is applied just below.
  const { themes, issues: themeIssues } = resolveThemes(config.themes ?? {});
  registerThemes(themes);
  // The prefersMonochrome check (see theme/mono.ts) replaces the configured
  // Selection with the built-in monochrome pair. A later explicit pick in the
  // Theme switcher still applies: no-color.org asks that color stop being the
  // Default, not that the user be locked out of requesting it.
  const themeSelection = prefersMonochrome(process.env)
    ? { dark: "mono-dark", light: "mono-light" }
    : config.theme;
  setSelection(themeSelection);

  // Resolve servers first because language profiles validate their named references. Everything
  // Registers before the runtime builds, so diff, icons, diagnostics, and intel share one startup
  // Snapshot for the full session.
  const { issues: serverIssues, servers } = resolveServers(config.diagnostics?.servers ?? {});
  // The JSON server takes its schema map only as a post-`initialized` notification; the YAML server
  // Takes user associations through its `settings`. Fold both onto their specs before they register
  // (per-repo `{repoUri}` substitution happens later in `handshakeConfigFor`).
  const { issues: schemaIssues, schemas, userSchemas } = resolveSchemas(config.schemas ?? {});
  if (servers.json !== undefined) {
    servers.json = { ...servers.json, schemaAssociations: schemas };
  }
  if (servers.yaml !== undefined) {
    servers.yaml = { ...servers.yaml, settings: yamlSchemaSettings(userSchemas) };
  }
  registerServers(servers);
  const { issues: fileSupportIssues, registry: fileSupport } = resolveFileSupportConfig(
    { files: config.files, icons: config.icons?.glyphs, languages: config.languages },
    new Set(Object.keys(servers)),
  );
  registerFileSupport(fileSupport);
  const { issues: keybindingIssues, set: keybindings } = resolveKeybindings(
    config.keybindings ?? {},
  );
  registerKeybindings(keybindings);

  // Resolve the repository before the renderer enters the alt-screen, so "not a git repository"
  // Prints on the normal terminal instead of flashing an empty shell first. On its own runtime for
  // The same reason the config load has one: the first use of the app runtime builds DiffEngineLive,
  // Whose highlighter warm-up must stay behind the first paint.
  const preflightRuntime = ManagedRuntime.make(GitLive.pipe(Layer.provide(ProcessLive)));
  const { mainWorktreePath, repoRoot } = await preflightRuntime.runPromise(
    preflight(process.cwd()),
  );
  await preflightRuntime.dispose();

  // Create the renderer up front and detect the terminal's dark/light appearance
  // Before the first runtime use (which warms the diff highlighter), so the whole
  // App themes to match. Detection is a bounded terminal query; a terminal that
  // Does not answer within the timeout falls back to dark. The same renderer is
  // Reused for the first paint below, so detection costs no extra frame.
  // Disable OpenTUI's focus-the-element-under-the-pointer on mouse-down
  // (`autoFocus`), which would otherwise draw the terminal cursor in a clicked
  // Renderable (e.g. a tab). stet drives focus through its own keymap, and
  // Overlay inputs focus via their explicit `focused` prop, so nothing relies on it.
  const renderer = await createCliRenderer({ autoFocus: false, exitOnCtrlC: false });
  const appearance = (await renderer.waitForThemeMode(100)) ?? "dark";

  // Restore the terminal on every exit path, not just a clean quit. In raw mode a
  // Keyboard ctrl-c is a keypress the keymap owns, so these process signals fire
  // Only on an external kill or a crash — exactly the paths that otherwise leave
  // The alt-screen buffer active and the next launch blank. destroy() is
  // Idempotent, so racing the keymap's own quit is harmless.
  const restoreTerminal = () => {
    renderer.setTerminalTitle("");
    renderer.destroy();
  };
  const crash = (error: unknown) => {
    restoreTerminal();
    logError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      restoreTerminal();
      process.exit(0);
    });
  }
  process.on("uncaughtException", crash);
  process.on("unhandledRejection", crash);

  // Apply the detected appearance and validate the active theme name. Both need
  // The renderer's appearance and are non-throwing, so running them after the
  // Alt-screen is entered leaves no window for a blank-on-error. Selection +
  // Appearance together feed the active theme before the first runtime use warms
  // The highlighter; the renderer's theme_mode event updates appearance live.
  setAppearance(appearance);
  const activeName = selectThemeName(themeSelection, appearance);
  if (!hasTheme(activeName)) {
    themeIssues.push(`theme "${activeName}" not found; using the ${appearance} default`);
  }

  // The CLI- and config-derived state needs no git, so seed it before the first
  // Paint. A CLI flag wins over its config key for the run it was passed on (the
  // Off-flags only ever turn a feature off, so flag-or-config composes with ||).
  batch(() => {
    state.setScope(options.scope);
    state.setCliBaseRef(options.scope.ref);
    state.setIconsEnabled(options.icons && (config.icons?.enabled ?? configDefaults.icons.enabled));
    state.setOverflow(
      options.overflow === "wrap" || (config.viewer?.wrap ?? configDefaults.viewer.wrap)
        ? "wrap"
        : "scroll",
    );
    state.setEditorTemplate(resolveEditorTemplate(options.editor ?? config.editor));
    state.setIdeTemplate(resolveIdeTemplate(options.ide ?? config.ide));
    // The raw flags, so ctrl-s can persist a literal --editor/--ide (never the
    // Resolved template, which folds in environment fallbacks).
    state.setEditorFlag(options.editor);
    state.setIdeFlag(options.ide);
    state.setSidebarPosition(config.sidebar?.position ?? configDefaults.sidebar.position);
    state.setSidebarWidthOverride(config.sidebar?.width ?? null);
    state.setSidebarHeightOverride(config.sidebar?.height ?? null);
    state.setChangesOnly(config.sidebar?.changesOnly ?? configDefaults.sidebar.changesOnly);
    if (!(config.sidebar?.open ?? configDefaults.sidebar.open)) {
      // The one close path rather than a copy of it, so focus leaving the hidden tree is
      // Decided in the same place here as it is for `ctrl-b` and a shrink past the minimum.
      state.collapseSidebar();
    }
    state.setProblemsPosition(config.problems?.position ?? configDefaults.problems.position);
    state.setProblemsHeightOverride(config.problems?.height ?? null);
    state.setProblemsWidthOverride(config.problems?.width ?? null);
    // Seeding the panel open is an initial condition, so unlike `p` it does not take
    // Focus: only the action that means "go look at problems" focuses the panel.
    state.setProblemsOpen(config.problems?.open ?? configDefaults.problems.open);
    state.setBlameEnabled(config.provenance?.enabled ?? configDefaults.provenance.enabled);
    state.setDiagnosticsEnabled(diagnosticsEnabled);
    state.setIntelEnabled(config.intel?.enabled ?? configDefaults.intel.enabled);
    state.setSearchRegex(config.search?.regex ?? configDefaults.search.regex);
    state.setSearchCaseSensitive(
      config.search?.caseSensitive ?? configDefaults.search.caseSensitive,
    );
    state.setSearchScope(config.search?.scope ?? configDefaults.search.scope);
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

  // Check for a newer release in the background, independent of the git load, so it neither gates
  // Nor is gated by it. A hit surfaces on the way out via the quit notice.
  if (config.update?.check ?? configDefaults.update.check) {
    void state.checkForUpdate(packageJson.version);
  }

  runtime
    .runPromise(startup(repoRoot))
    .then(({ changed, scope, sessionBase, unborn }) => {
      const model: GitModel = { repoRoot, ...changed, repoFiles: [], repoFilesKey: "" };
      const initialSelectedPath = model.changed[0]?.path ?? model.repoFiles[0]?.path;
      const baseExpanded = defaultExpandedDirectories(model.changed.map((file) => file.path));
      const initialExpanded =
        initialSelectedPath === undefined
          ? baseExpanded
          : expandAncestorsForPath(baseExpanded, initialSelectedPath);

      batch(() => {
        state.setHeadUnborn(unborn);
        state.setScope(scope);
        state.setSessionBase(sessionBase);
        state.setGitModel(model);
        state.setRepoRoot(model.repoRoot);
        state.setMainWorktreePath(mainWorktreePath);
        state.setLastChange(Date.now());
        state.seedNav(initialSelectedPath);
        state.setFocusedNodeId(
          initialSelectedPath === undefined ? "" : `file:${initialSelectedPath}`,
        );
        state.setExpandedDirectories(initialExpanded);
        // Disabled diagnostics seed empty, or the pending placeholders never resolve.
        state.setCheckerState(initialCheckerState(diagnosticsEnabled ? model.changed : []));
      });
      void state.runChecks(model);

      // A bad config never blocks startup; the first issue surfaces as a notice.
      const issues = [
        ...configIssues,
        ...themeIssues,
        ...serverIssues,
        ...schemaIssues,
        ...fileSupportIssues,
        ...keybindingIssues,
      ];
      if (issues.length > 0) {
        state.notify(issues[0] ?? "config has issues");
      }
    })
    .catch(crash);
} catch (error) {
  logError(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
