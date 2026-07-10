/**
 * Regenerate the docs screenshots by driving the real stet binary through VHS (a headless terminal
 * that renders Nerd Font icons correctly), so the icons and theme match a real terminal. Each
 * screen is a generated .tape that launches stet, drives it to a state with keystrokes, and
 * screenshots it. The problems/diagnostics shots need a changed file with diagnostics, so a temp
 * errorful file is created in src/ around those runs only.
 *
 * Capture against a clean checkout so the tree and diff are representative — uncommitted files show
 * up in the captured tree. By default that's this repo; set `STET_SCREENSHOT_REPO` to point stet at
 * another checkout (e.g. a clean main worktree) while the images still land in THIS repo's docs.
 * Requires `vhs` on PATH (brew install vhs) and a Nerd Font installed for the file-type icons. Pass
 * screen names to shoot a subset, e.g. `bun run screenshots find problems`.
 *
 * Screens marked `worktree: true` launch from a throwaway linked worktree instead, so the header
 * renders its worktree identity rather than the main checkout's.
 */
import { existsSync, rmSync, symlinkSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Where the images are written: the docs site serves this dir at /screenshots, and the README links
 * into it, so it is the single committed home. Always this repo, so a PR here picks them up.
 */
const OUT = resolve(import.meta.dir, "../../../docs/public/screenshots");
/**
 * Which checkout stet runs against (the repo root; the tapes cd into its packages/tui); override
 * with a post-restructure checkout to capture a clean tree elsewhere.
 */
const REPO = process.env.STET_SCREENSHOT_REPO
  ? resolve(process.env.STET_SCREENSHOT_REPO)
  : resolve(import.meta.dir, "../../..");
const BUN = process.execPath;
const VHS = "vhs";
/** Optional lossless PNG optimizer; when absent the raw (larger) VHS output ships unchanged. */
const OXIPNG = Bun.which("oxipng");
const TAPES = resolve(tmpdir(), "stet-screenshots");
/**
 * Pinned to the monorepo restructure commit: everything after it is clean feature work, so the diff
 * shows real code changes rather than the ~200 files the `src`→`packages/tui/src` move renamed. A
 * relative `HEAD~N` drifts across whatever commits happen to be there (it had slid onto release
 * commits, leaving the diff empty). Bump this when a newer, richer window exists, and re-point the
 * tapes below that name a file: they each need one that is actually changed in the window.
 */
const BASE_REF = "f1e0d21";
/**
 * Inside src/ so it falls under tsconfig's include and typescript-language-server reports the type
 * error alongside oxlint's unused-symbol findings.
 */
const FIXTURE = `${REPO}/packages/tui/src/_diagnostics-demo.ts`;
/**
 * A throwaway linked worktree for the `worktree: true` screens: stet derives its git identity from
 * the cwd, so launching there renders the header's worktree form (`folder · branch`, file-tree
 * glyph) instead of the main checkout's (`repo · branch`, repo glyph). It branches from `HEAD` so
 * the diff against `BASE_REF` matches every other shot, and it lives under `.claude/worktrees/`
 * (gitignored, so it never shows up in another shot's tree) because a fresh worktree has no
 * `node_modules` and bun only finds the hoisted install by walking up to the repo root. The folder
 * and branch deliberately differ, since a branch that strictly equals its folder is dropped.
 */
const WORKTREE_DIR = `${REPO}/.claude/worktrees/pull-diagnostics`;
const WORKTREE_BRANCH = "feat/pull-diagnostics";
/**
 * A throwaway config dir for the theme-switcher shot only: stet reads `XDG_CONFIG_HOME`, so
 * pointing that one tape here populates the theme list with named palettes (rich swatches and a
 * real diff re-theme on preview) without touching the user's real config or the other tapes.
 */
const THEME_CONFIG_DIR = resolve(tmpdir(), "stet-screenshots-config");
const THEME_CONFIG_FILE = resolve(THEME_CONFIG_DIR, "stet", "config.jsonc");
/** Where git and stet alike look for their per-user config when `XDG_CONFIG_HOME` is unset. */
const REAL_CONFIG_HOME = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
// Named palettes for the theme-switcher shot: each carries a distinct accent (the row swatch) and a
// Bundled Shiki `syntax` (so previewing one re-themes the diff). `theme` stays unset so the app
// Starts on `auto`, keeping the ✓ on `auto` while the highlighted row previews a different theme.
const THEME_CONFIG = JSON.stringify(
  {
    // Registration (and so list) order after auto/dark/light, sorted: catppuccin,
    // Gruvbox, rose-pine, tokyo-night, so Down x6 lands the highlight on tokyo-night.
    themes: {
      "catppuccin": { accent: { primary: "#cba6f7" }, base: "dark", syntax: "catppuccin-mocha" },
      "gruvbox": { accent: { primary: "#fabd2f" }, base: "dark", syntax: "gruvbox-dark-medium" },
      "rose-pine": { accent: { primary: "#ebbcba" }, base: "dark", syntax: "rose-pine" },
      "tokyo-night": { accent: { primary: "#7aa2f7" }, base: "dark", syntax: "tokyo-night" },
    },
  },
  null,
  2,
);

// Canvas height, shared by every capture.
const CANVAS_HEIGHT = 1520;
function header() {
  return [
    "Set Shell zsh",
    'Set FontFamily "FiraCode Nerd Font Mono"',
    "Set FontSize 28",
    "Set Width 2560",
    `Set Height ${CANVAS_HEIGHT}`,
    "Set Padding 0",
    "Set Margin 0",
    "Set TypingSpeed 0",
  ].join("\n");
}

// VHS runs with cwd = the tmp tape dir, so cd into the capture target before launching stet.
// `env` lets one screen prefix the launch (e.g. XDG_CONFIG_HOME for the theme shot); every other
// Tape passes nothing, so its command is unchanged. `root` is the checkout stet reads its git
// Identity from, which the `worktree: true` screens point at the demo worktree.
function launchCmd(env = "", root = REPO) {
  return [
    "Hide",
    `Type "cd ${root}/packages/tui && ${env}${BUN} run src/main.tsx ${BASE_REF}"`,
    "Enter",
    "Sleep 3s",
    "Show",
    "Sleep 500ms",
  ].join("\n");
}

/**
 * Open a substantial real source-file diff (the palette focuses the viewer on select), so the hero
 * and theme shots feature a changed file with hunks rather than the default docs file.
 * `diagnostics/servers` carries the largest source diff in the `BASE_REF..HEAD` window (+266/-95)
 * and opens on interleaved additions and removals, so it reads as real review work.
 */
const openServersDiff = [
  "Ctrl+P",
  'Type "diagnostics/servers"',
  "Sleep 400ms",
  "Enter",
  "Sleep 800ms",
].join("\n");

/**
 * One entry per README screenshot. `steps` run after the app is up; the end state is captured.
 * `fixture: true` marks screens that need the temporary diagnostics file planted first.
 */
const screens = [
  // Let the diff settle and the checks finish (tsserver project load is the slow part) so the hero
  // Shot shows the resolved "checks finished" state, not a mid-run spinner.
  { name: "stet", steps: [openServersDiff, "Sleep 16s"].join("\n"), worktree: true },
  {
    /**
     * Pin two files into tabs (`ctrl-t`), then land on a third as the active preview, so the strip
     * shows the two pinned tabs (muted) beside the active preview tab (full-strength, italic). All
     * three carry a diff so the tabs show their status tint; `diagnostics/servers`, `git/model`,
     * and `components/HeaderBar` all sit in the captured `BASE_REF..HEAD` window, and their
     * basenames stay distinct so the strip reads at a glance.
     */
    name: "tabs",
    steps: [
      "Ctrl+P",
      'Type "diagnostics/servers"',
      "Sleep 400ms",
      "Enter",
      "Sleep 700ms",
      "Ctrl+T",
      "Sleep 300ms",
      "Ctrl+P",
      'Type "git/model"',
      "Sleep 400ms",
      "Enter",
      "Sleep 700ms",
      "Ctrl+T",
      "Sleep 300ms",
      "Ctrl+P",
      'Type "components/HeaderBar"',
      "Sleep 400ms",
      "Enter",
      "Sleep 900ms",
    ].join("\n"),
  },
  { name: "scope-picker", steps: ['Type "s"', "Sleep 800ms"].join("\n") },
  { name: "worktree-picker", steps: ['Type "w"', "Sleep 800ms"].join("\n") },
  {
    /**
     * Open a diff so a real code hunk sits behind the overlay, open the switcher, then arrow down
     * to a vivid theme (auto, dark, light, then the planted palettes) so the shot shows the full
     * themed list (accent swatches, the ✓ on the active `auto`, the highlighted preview row) with
     * the UI and diff live-re-themed to it. `Down` reaches the keymap's picker branch even with the
     * filter input focused, same as the palette/find tapes. Needs the planted demo config.
     */
    config: true,
    launchEnv: `XDG_CONFIG_HOME=${THEME_CONFIG_DIR} `,
    name: "theme-switcher",
    steps: [openServersDiff, 'Type "t"', "Sleep 700ms", "Down@200ms 6", "Sleep 1200ms"].join("\n"),
  },
  { name: "go-to-file", steps: ["Ctrl+P", 'Type "diff"', "Sleep 600ms"].join("\n") },
  {
    /**
     * Open the diff and let it focus/settle, then open the find bar and type a term present in the
     * viewport where the file opens (lowercase "provision" is smart-case, so it also matches the
     * `Provisioner`/`ProvisionChannel` symbols in servers.ts's first two hunks, highlighting in
     * view rather than off-screen). Capture the open bar showing the live N/M counter and
     * highlights. No commit: a too-early `/` or a no-match Enter both collapse back to a plain diff
     * with no find UI, so generous settles and a real match matter.
     */
    name: "find",
    steps: [
      "Ctrl+P",
      'Type "diagnostics/servers"',
      "Sleep 500ms",
      "Enter",
      "Sleep 1500ms",
      'Type "/"',
      "Sleep 600ms",
      'Type "provision"',
      "Sleep 1s",
    ].join("\n"),
  },
  {
    /**
     * The full-view search pane: type a query with matches across several changed files, wait for
     * the grep + context reads + highlight to settle, then arrow into the results so the shot shows
     * the selection tint on a match row alongside the grouped, syntax-highlighted context.
     */
    name: "search",
    steps: ["Ctrl+F", 'Type "Effect"', "Sleep 2s", "Down@250ms 4", "Sleep 1200ms"].join("\n"),
  },
  {
    // Open an unchanged file: plain syntax-highlighted source, no diff gutters.
    name: "read-only",
    steps: ["Ctrl+P", 'Type "process"', "Sleep 400ms", "Enter", "Sleep 800ms"].join("\n"),
    worktree: true,
  },
  {
    /**
     * Open a source file, jump the caret onto a function header with `/`, and press `z` to fold its
     * body: the block collapses behind a `▸ N lines folded` marker while the header stays. `Type
     * "z"` reaches the diff pane's fold toggle (the caret is inside the function after the jump).
     */
    name: "folding",
    steps: [
      "Ctrl+P",
      'Type "git/tree"',
      "Sleep 500ms",
      "Enter",
      "Sleep 1500ms",
      'Type "/"',
      "Sleep 300ms",
      'Type "function flattenTree"',
      "Sleep 500ms",
      "Enter",
      "Sleep 500ms",
      "Escape",
      "Sleep 300ms",
      'Type "z"',
      "Sleep 1200ms",
    ].join("\n"),
  },
  {
    /**
     * Open a real source diff, jump the caret onto a JSDoc'd exported function with `/`, hop to its
     * name, and press `K`. The hover card shows the syntax-highlighted signature above the plain
     * doc text, anchored at the caret over the diff. The long final sleep waits out tsserver's
     * project load before it answers the first hover (same order as the problems shot). `Type "K"`
     * sends the shift+K the keymap matches.
     */
    name: "hover",
    steps: [
      "Ctrl+P",
      'Type "diff/engine"',
      "Sleep 500ms",
      "Enter",
      "Sleep 1500ms",
      'Type "/"',
      "Sleep 300ms",
      'Type "function highlightSnippet"',
      "Sleep 500ms",
      "Enter",
      "Sleep 500ms",
      "Escape",
      "Sleep 300ms",
      'Type "lll"',
      "Sleep 400ms",
      'Type "K"',
      "Sleep 16s",
    ].join("\n"),
  },
  {
    /**
     * Open the file that declares a widely-implemented interface, jump the caret to its declaration
     * with `/`, then hop two words (`ll` is word-forward: export → interface → LspConnection) onto
     * the interface name, since implementation resolves the symbol under the caret. Press Shift+I:
     * the overlay lists every concrete implementor grouped by file with each source line. The long
     * sleep waits out tsserver's project load before implementation answers (same order as the
     * hover/call-hierarchy shots). `Type "I"` sends the shift+I the keymap matches.
     */
    name: "find-implementations",
    steps: [
      "Ctrl+P",
      'Type "diagnostics/transport"',
      "Sleep 500ms",
      "Enter",
      "Sleep 1500ms",
      'Type "/"',
      "Sleep 300ms",
      'Type "interface LspConnection"',
      "Sleep 500ms",
      "Enter",
      "Sleep 500ms",
      "Escape",
      "Sleep 300ms",
      'Type "ll"',
      "Sleep 400ms",
      'Type "I"',
      "Sleep 16s",
    ].join("\n"),
  },
  {
    /**
     * Open the file that defines a widely-called function, jump the caret to its line with `/`,
     * then hop three words (`lll` is word-forward: export → async → function → highlightSnippet)
     * onto the name, since prepareCallHierarchy needs the identifier itself. Press Shift+H: the
     * overlay lists the callers grouped by file with the `⇥ direction` hint in the footer. The long
     * sleep waits out tsserver's project load before prepare/resolve answers (same order as the
     * hover/find-symbols shots). `Type "H"` sends the shift+H the keymap matches.
     */
    name: "call-hierarchy",
    steps: [
      "Ctrl+P",
      'Type "diff/engine"',
      "Sleep 500ms",
      "Enter",
      "Sleep 1500ms",
      'Type "/"',
      "Sleep 300ms",
      'Type "function highlightSnippet"',
      "Sleep 500ms",
      "Enter",
      "Sleep 500ms",
      "Escape",
      "Sleep 300ms",
      'Type "lll"',
      "Sleep 400ms",
      'Type "H"',
      "Sleep 16s",
    ].join("\n"),
  },
  {
    /**
     * Open a symbol-rich source file, then press S to open the outline overlay. Arrow down a few
     * rows so the shot shows the selection tint mid-list alongside the kind icons, nesting indent,
     * and line:col column. The long sleep waits out tsserver's project load before documentSymbol
     * answers (same order as the hover/problems shots).
     */
    name: "find-symbols",
    steps: [
      "Ctrl+P",
      'Type "src/state"',
      "Sleep 500ms",
      "Enter",
      "Sleep 1500ms",
      'Type "S"',
      "Sleep 16s",
      "Down@250ms 5",
      "Sleep 1200ms",
    ].join("\n"),
  },
  {
    // Open the fixture, open the panel, then wait out tsserver's project load (slower than oxlint).
    fixture: true,
    name: "problems",
    steps: [
      "Ctrl+P",
      'Type "diagnostics-demo"',
      "Sleep 400ms",
      "Enter",
      "Sleep 800ms",
      'Type "p"',
      "Sleep 16s",
    ].join("\n"),
  },
];

function tapeFor(screen: (typeof screens)[number]) {
  return [
    `# ${screen.name}.png — generated by script/screenshots.ts`,
    header(),
    launchCmd(screen.launchEnv, screen.worktree ? WORKTREE_DIR : REPO),
    screen.steps,
    // Written next to the tape in the tmp dir (VHS's cwd), then moved into OUT.
    `Screenshot ${screen.name}.png`,
    "",
  ].join("\n\n");
}

async function run(cmd: string, cmdArgs: string[], cwd = TAPES) {
  const proc = Bun.spawn([cmd, ...cmdArgs], {
    cwd,
    stdio: ["inherit", "inherit", "inherit"],
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`${cmd} exited ${code}`);
  }
}

async function shoot(screen: (typeof screens)[number]) {
  await Bun.write(`${TAPES}/${screen.name}.tape`, tapeFor(screen));
  console.log(`▶ ${screen.name}`);
  await run(VHS, [`${TAPES}/${screen.name}.tape`]);
  const png = `${OUT}/${screen.name}.png`;
  await Bun.write(png, Bun.file(`${TAPES}/${screen.name}.png`));
  if (OXIPNG) {
    await run(OXIPNG, ["-o", "max", "--strip", "safe", png]);
  }
}

/**
 * Diagnostics only exist for a changed file, so plant one. Lead with clean exported lines (no
 * findings, plain gutter) so the flagged lines' severity-colored gutter numbers stand out, then tsc
 * type errors (number = string) and oxc unused-symbol findings.
 */
// Refuse to clobber a pre-existing FIXTURE: that path is script-owned, so anything
// There wasn't put by us, and `plantedFixture` makes removeFixture delete only what
// This run created rather than blindly rm-ing the path.
let plantedFixture = false;
function writeFixture() {
  if (existsSync(FIXTURE)) {
    throw new Error(`refusing to overwrite existing ${FIXTURE} (not created by this script)`);
  }
  plantedFixture = true;
  return Bun.write(
    FIXTURE,
    [
      "export function double(n: number) {",
      "  return n * 2",
      "}",
      "",
      'export const label: number = "oops"',
      "const ignored = double(label)",
      "const count: string = 42",
      "function helper(unusedParam: number) {}",
      "",
    ].join("\n"),
  );
}

// Removers are sync so a signal handler can run them before exit, not just the finally path.
function removeFixture() {
  if (!plantedFixture) {
    return;
  }
  rmSync(FIXTURE, { force: true });
  plantedFixture = false;
}

// Same ownership rule as the fixture: refuse a path we did not create, and only tear down our own.
let plantedWorktree = false;
async function addWorktree() {
  if (existsSync(WORKTREE_DIR)) {
    throw new Error(`refusing to reuse existing ${WORKTREE_DIR} (not created by this script)`);
  }
  plantedWorktree = true;
  await run("git", ["worktree", "add", "-b", WORKTREE_BRANCH, WORKTREE_DIR, "HEAD"], REPO);
  // A linked worktree starts with no node_modules, which a real one gets from `bun install`. Without
  // It the checkers resolve to stet's provisioned cache instead of the repo's pinned binaries, and
  // Oxlint cannot load the `$schema` its config points at, badging a warning that belongs to this
  // Rig rather than the repo. Symlinking the main install instead would leave an untracked
  // `node_modules` in the changed count, since gitignore's `node_modules/` matches only a directory.
  await run(BUN, ["install", "--frozen-lockfile"], WORKTREE_DIR);
}

// Sync like the other removers, so the signal handler can tear the worktree down before exit.
// `--force` twice: once for the worktree's own install, once for the branch it never merged.
function removeWorktree() {
  if (!plantedWorktree) {
    return;
  }
  Bun.spawnSync(["git", "worktree", "remove", "--force", WORKTREE_DIR], { cwd: REPO });
  Bun.spawnSync(["git", "branch", "-D", WORKTREE_BRANCH], { cwd: REPO });
  plantedWorktree = false;
}

async function writeThemeConfig() {
  await Bun.write(THEME_CONFIG_FILE, THEME_CONFIG);
  // `XDG_CONFIG_HOME` is not stet's alone: git resolves its own global config there too, and with it
  // `core.excludesFile`. A bare override drops the user's global ignores, so files they ignore
  // (`.claude/settings.local.json`) count as changed and this shot's tree and count disagree with
  // Every other one. Link the real git config back in so only stet's config moves.
  const realGitConfig = join(REAL_CONFIG_HOME, "git");
  if (existsSync(realGitConfig)) {
    symlinkSync(realGitConfig, join(THEME_CONFIG_DIR, "git"), "dir");
  }
}

// Recursive, but `rmSync` unlinks the linked-in git config rather than descending into it.
function removeThemeConfig() {
  rmSync(THEME_CONFIG_DIR, { force: true, recursive: true });
}

const only = new Set(Bun.argv.slice(2));
const unknown = [...only].filter((name) => !screens.some((screen) => screen.name === name));
if (unknown.length > 0) {
  console.warn(
    `ignoring unknown screen name(s): ${unknown.join(", ")} — known: ${screens.map((screen) => screen.name).join(", ")}`,
  );
}

if (!OXIPNG) {
  console.warn("oxipng not found — skipping lossless compression (brew install oxipng)");
}

const wanted = screens.filter((screen) => only.size === 0 || only.has(screen.name));
const standalone = wanted.filter((screen) => !screen.fixture && !screen.worktree);
const worktreed = wanted.filter((screen) => screen.worktree);
const fixtured = wanted.filter((screen) => screen.fixture);

// One cleanup list drives both the finally and the signal handlers, so a Ctrl-C mid-shoot leaves
// Behind neither the temp theme config nor the diagnostics fixture.
const cleanups: (() => void)[] = [];
function cleanup() {
  for (const remove of cleanups.splice(0)) {
    remove();
  }
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    cleanup();
    process.exit(130);
  });
}

try {
  // The theme shot reads named palettes from a temp config via XDG_CONFIG_HOME; it creates no repo
  // File, so planting it up front never pollutes the other shots.
  if (wanted.some((screen) => screen.config)) {
    await writeThemeConfig();
    cleanups.push(removeThemeConfig);
  }

  for (const screen of standalone) {
    // oxlint-disable-next-line no-await-in-loop -- vhs spawns a headless terminal; runs must be sequential
    await shoot(screen);
  }

  if (worktreed.length > 0) {
    // The worktree picker lists every linked worktree, so plant the demo one only after the
    // Main-checkout shots, and tear it down through the shared cleanup.
    await addWorktree();
    cleanups.push(removeWorktree);
    for (const screen of worktreed) {
      // oxlint-disable-next-line no-await-in-loop -- vhs spawns a headless terminal; runs must be sequential
      await shoot(screen);
    }
  }

  if (fixtured.length > 0) {
    // An errorful file in src/ would show up in every other shot's tree, so plant it only now,
    // After the standalone shots, and tear it down through the shared cleanup.
    await writeFixture();
    cleanups.push(removeFixture);
    for (const screen of fixtured) {
      // oxlint-disable-next-line no-await-in-loop -- vhs spawns a headless terminal; runs must be sequential
      await shoot(screen);
    }
  }
} finally {
  cleanup();
}

console.log("done");
