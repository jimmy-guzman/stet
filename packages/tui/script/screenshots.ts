/**
 * Regenerate the docs screenshots by driving the real stet binary through VHS (a headless terminal
 * that renders Nerd Font icons correctly), so the icons and theme match a real terminal. Each
 * screen is a generated .tape that launches stet, drives it to a state with keystrokes, and
 * screenshots it.
 *
 * Capture against a clean checkout so the tree and diff are representative — uncommitted files show
 * up in the captured tree. By default that's this repo; set `STET_SCREENSHOT_REPO` to point stet at
 * another checkout (e.g. a clean main worktree) while the images still land in THIS repo's docs.
 * Requires `vhs` on PATH (brew install vhs) and a Nerd Font installed for the file-type icons. Pass
 * screen names to shoot a subset, e.g. `bun run screenshots find tabs`.
 *
 * Screens marked `worktree: true` launch from a throwaway linked worktree instead, so the header
 * renders its worktree identity rather than the main checkout's. Screens marked `recentEdits: true`
 * append a line to real source files mid-run and restore them byte-for-byte afterwards, since
 * recency only exists for a change stet observes while it is running; they run last for that
 * reason.
 */
import { existsSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

/**
 * Where the images are written: the docs site serves this dir at /screenshots, and the README links
 * into it, so it is the single committed home. Always this repo, so a PR here picks them up.
 */
const OUT = path.resolve(import.meta.dir, "../../../docs/public/screenshots");

/**
 * Which checkout stet runs against (the repo root; the tapes cd into its packages/tui); override
 * with a post-restructure checkout to capture a clean tree elsewhere.
 */
const REPO_OVERRIDE = process.env.STET_SCREENSHOT_REPO ?? "";

const REPO =
  REPO_OVERRIDE === ""
    ? path.resolve(import.meta.dir, "../../..")
    : path.resolve(REPO_OVERRIDE);

const BUN = process.execPath;
const VHS = "vhs";

/** Optional lossless PNG optimizer; when absent the raw (larger) VHS output ships unchanged. */
const OXIPNG = Bun.which("oxipng");
const TAPES = path.resolve(tmpdir(), "stet-screenshots");

/**
 * Pinned to the monorepo restructure commit: everything after it is clean feature work, so the diff
 * shows real code changes rather than the ~200 files the `src`→`packages/tui/src` move renamed. A
 * relative `HEAD~N` drifts across whatever commits happen to be there (it had slid onto release
 * commits, leaving the diff empty). Bump this when a newer, richer window exists, and re-point the
 * tapes below that name a file: they each need one that is actually changed in the window.
 */
const BASE_REF = "f1e0d21";

/**
 * A throwaway image for the binary-preview shot: an untracked PNG so the viewer renders its
 * metadata card (type, dimensions, size) instead of a diff. Generated with ffmpeg (already required
 * by VHS) at a legible size, and planted only for that shot so it never shows up in another tree.
 */
const IMAGE_FIXTURE = `${REPO}/packages/tui/_demo-image.png`;

/**
 * A throwaway linked worktree for the `worktree: true` screens: stet derives its git identity from
 * the cwd, so launching there renders the header's worktree form (`folder · branch`, file-tree
 * glyph) instead of the main checkout's (`repo · branch`, repo glyph). It branches from `HEAD` so
 * the diff against `BASE_REF` matches every other shot, and it lives under `.claude/worktrees/`
 * (gitignored, so it never shows up in another shot's tree) because a fresh worktree has no
 * `node_modules` and bun only finds the hoisted install by walking up to the repo root. The folder
 * and branch deliberately differ, since a branch that strictly equals its folder is dropped.
 */
const WORKTREE_DIR = `${REPO}/.claude/worktrees/tidy-layout`;
const WORKTREE_BRANCH = "feat/tidy-layout";

/**
 * A throwaway config dir for the `config: true` shots: stet reads `XDG_CONFIG_HOME`, so pointing
 * those tapes here gives them named themes and a reachable context-menu binding without touching
 * the user's real config or the other tapes. It is rewritten before every such shot, because
 * `ctrl-s` makes one of them a writer.
 */
const SCREENSHOT_CONFIG_DIR = path.resolve(tmpdir(), "stet-screenshots-config");

const SCREENSHOT_CONFIG_FILE = path.resolve(
  SCREENSHOT_CONFIG_DIR,
  "stet",
  "config.jsonc"
);

/** Where git and stet alike look for their per-user config when `XDG_CONFIG_HOME` is unset. */
const REAL_CONFIG_HOME =
  process.env.XDG_CONFIG_HOME ?? path.join(homedir(), ".config");

const SCREENSHOT_CONFIG = JSON.stringify(
  {
    /**
     * VHS has no F-key: it rejects a bare `F10`, and `Shift+F10` parses as the shift modifier over
     * the literal text "F10", which it types instead of sending the key. The context menu's only
     * other opener is a right-click, which VHS cannot send either, so the shot rebinds it. Nothing
     * in the capture reveals this: the menu's footer hint names its own keys, never its opener.
     */
    keybindings: { "context-menu": "ctrl+n" },
    /**
     * Named palettes for the theme-switcher shot: each carries a distinct accent (the row swatch)
     * and a bundled `syntax` theme (so previewing one re-themes the diff). `theme` stays unset so
     * the app starts on `auto`, keeping the ✓ there while the highlighted row previews another.
     * Registration (and so list) order after the built-ins, sorted: catppuccin, gruvbox,
     * rose-pine, tokyo-night, the last of the nine rows the switcher then lists.
     */
    themes: {
      catppuccin: {
        accent: { primary: "#cba6f7" },
        base: "dark",
        syntax: "catppuccin-mocha",
      },
      gruvbox: {
        accent: { primary: "#fabd2f" },
        base: "dark",
        syntax: "gruvbox-dark-medium",
      },
      "rose-pine": {
        accent: { primary: "#ebbcba" },
        base: "dark",
        syntax: "rose-pine",
      },
      "tokyo-night": {
        accent: { primary: "#7aa2f7" },
        base: "dark",
        syntax: "tokyo-night",
      },
    },
  },
  null,
  2
);

/**
 * The recency shot's edits, applied in order while stet is already running. Recency cannot be
 * staged before launch: the activity log is built by diffing successive git models and the first
 * one is only a baseline, so a file already changed at startup carries no cue however recent its
 * mtime is. These are real source files this diff window already changed, so an appended line reads
 * as an agent's edit rather than a planted file.
 *
 * Two things here are calibrated, and the first attempt got both wrong. They all sit directly under
 * `src/`, so the jump to the newest leaves the other two on screen; three files from three
 * directories left the earliest one scrolled out of the tree. And they are spaced 6s apart, so the
 * dots land a fifth of the 30s `RECENT_MS` fade apart from each other; 3s apart put every one of
 * them at nearly the same point and the ramp the shot exists to show read as one flat state.
 *
 * `afterMs` is the wait before each edit, cumulative, and coupled to the tape's own settle below:
 * every edit must land before it presses `.`, and the oldest must still be inside the 30s window.
 */
const RECENT_EDITS = [
  { afterMs: 5000, path: `${REPO}/packages/tui/src/app.tsx` },
  { afterMs: 6000, path: `${REPO}/packages/tui/src/keymap.ts` },
  { afterMs: 6000, path: `${REPO}/packages/tui/src/state.ts` },
];

// Canvas height, shared by every capture.
const CANVAS_HEIGHT = 1520;

const header = () =>
  [
    "Set Shell zsh",
    'Set FontFamily "FiraCode Nerd Font Mono"',
    "Set FontSize 28",
    "Set Width 2560",
    `Set Height ${CANVAS_HEIGHT}`,
    "Set Padding 0",
    "Set Margin 0",
    "Set TypingSpeed 0",
  ].join("\n");

// VHS runs with cwd = the tmp tape dir, so cd into the capture target before launching stet.
// `env` lets one screen prefix the launch (e.g. XDG_CONFIG_HOME for the theme shot); every other
// Tape passes nothing, so its command is unchanged. `root` is the checkout stet reads its git
// Identity from, which the `worktree: true` screens point at the demo worktree.
const launchCmd = (env = "", root = REPO) =>
  [
    "Hide",
    `Type "cd ${root}/packages/tui && ${env}${BUN} run src/main.tsx ${BASE_REF}"`,
    "Enter",
    "Sleep 3s",
    "Show",
    "Sleep 500ms",
  ].join("\n");

/**
 * Open a substantial real source-file diff (the palette focuses the viewer on select), so the hero
 * and theme shots feature a changed file with hunks rather than the default docs file.
 * `components/diff/DiffView` carries one of the largest source diffs in the `BASE_REF..HEAD` window
 * (+254/-201) and interleaves additions and removals, so it reads as real review work.
 */
const openHeroDiff = [
  "Ctrl+P",
  'Type "diff/DiffView"',
  "Sleep 400ms",
  "Enter",
  "Sleep 800ms",
].join("\n");

/** One entry per README screenshot. `steps` run after the app is up; the end state is captured. */
const screens = [
  {
    name: "stet",
    steps: [openHeroDiff, "Sleep 1500ms"].join("\n"),
    worktree: true,
  },
  {
    /**
     * Pin two files into tabs (`ctrl-t`), then land on a third as the active preview, so the strip
     * shows the two pinned tabs (muted) beside the active preview tab (full-strength, italic). All
     * three carry a diff so the tabs show their status tint; `diff/DiffView`, `git/model`, and
     * `components/HeaderBar` all sit in the captured `BASE_REF..HEAD` window, and their basenames
     * stay distinct so the strip reads at a glance.
     */
    name: "tabs",
    steps: [
      "Ctrl+P",
      'Type "diff/DiffView"',
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
     * to a vivid theme so the shot shows the full themed list (accent swatches, the ✓ on the active
     * `auto`, the highlighted preview row) with the UI and diff live-re-themed to it. `Down`
     * reaches the keymap's picker branch even with the filter input focused, same as the
     * palette/find tapes. Needs the planted demo config.
     *
     * The count is positional, so it goes stale when the built-in list grows: it was 6 for a list
     * of auto/dark/light plus the four planted palettes, and the `mono-dark`/`mono-light` pair
     * landed between them, which quietly moved the highlight two rows short of its target. Recount
     * it against `themeNames()` whenever a built-in theme is added.
     */
    config: true,
    launchEnv: `XDG_CONFIG_HOME=${SCREENSHOT_CONFIG_DIR} `,
    name: "theme-switcher",
    steps: [
      openHeroDiff,
      'Type "t"',
      "Sleep 700ms",
      "Down@200ms 8",
      "Sleep 1200ms",
    ].join("\n"),
  },
  {
    /**
     * The one shot that must land inside the 1.5s notice window, so it screenshots right after the
     * keypress. Turn wrap on (`x`), then `ctrl-s`: the planted config does not declare it, so it
     * diverges from the file and the notice names it. It writes into the throwaway config dir
     * rather than the user's own, which is why `config: true` rewrites that file before every shot
     * that uses it.
     */
    config: true,
    launchEnv: `XDG_CONFIG_HOME=${SCREENSHOT_CONFIG_DIR} `,
    name: "save-settings",
    steps: [
      openHeroDiff,
      'Type "x"',
      "Sleep 800ms",
      "Ctrl+S",
      "Sleep 700ms",
    ].join("\n"),
  },
  {
    /**
     * Open the context menu on a file, which the prose beside it does not enumerate. `Ctrl+N` is
     * the planted rebind; see the config's `keybindings` note for why.
     */
    config: true,
    launchEnv: `XDG_CONFIG_HOME=${SCREENSHOT_CONFIG_DIR} `,
    name: "context-menu",
    steps: [
      "Ctrl+P",
      'Type "diff/engine"',
      "Sleep 500ms",
      "Enter",
      "Sleep 1500ms",
      'Type "v"',
      "Sleep 600ms",
      "Ctrl+N",
      "Sleep 1200ms",
    ].join("\n"),
  },
  {
    name: "go-to-file",
    steps: ["Ctrl+P", 'Type "diff"', "Sleep 600ms"].join("\n"),
  },
  {
    /**
     * Open the diff and let it focus/settle, then open the find bar and type a term present in the
     * viewport where the file opens (lowercase "window" is smart-case, so it also matches the
     * `visibleWindow`/`visibleWindowVariable` imports in DiffView's first hunk, highlighting in
     * view rather than off-screen). Capture the open bar showing the live N/M counter and
     * highlights. No commit: a too-early `/` or a no-match Enter both collapse back to a plain diff
     * with no find UI, so generous settles and a real match matter.
     */
    name: "find",
    steps: [
      "Ctrl+P",
      'Type "diff/DiffView"',
      "Sleep 500ms",
      "Enter",
      "Sleep 1500ms",
      'Type "/"',
      "Sleep 600ms",
      'Type "window"',
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
    steps: [
      "Ctrl+F",
      'Type "Effect"',
      "Sleep 2s",
      "Down@250ms 4",
      "Sleep 1200ms",
    ].join("\n"),
  },
  {
    // Open an unchanged file: plain syntax-highlighted source, no diff gutters.
    name: "read-only",
    steps: [
      "Ctrl+P",
      'Type "process"',
      "Sleep 400ms",
      "Enter",
      "Sleep 800ms",
    ].join("\n"),
    worktree: true,
  },
  {
    /**
     * Open the planted demo image. A terminal can't render pixels, so the viewer shows the metadata
     * card (type, dimensions, size) with the open-externally affordance instead of a blank diff
     * pane. The image is untracked, so it reads as an added binary.
     */
    imageFixture: true,
    name: "binary-preview",
    steps: [
      "Ctrl+P",
      'Type "demo-image"',
      "Sleep 500ms",
      "Enter",
      "Sleep 1200ms",
    ].join("\n"),
  },
  {
    /**
     * Open a diff, jump the caret onto a function header with `/`, and press `z` to fold its body:
     * the block collapses behind a `▸ N lines folded` marker while the header stays. `Type "z"`
     * reaches the diff pane's fold toggle (the caret is inside the function after the jump).
     * `layout/regions` is a file this window adds wholesale, so every line renders as a diff row
     * with no elided gap for the jump to miss, which an already-existing file cannot promise: the
     * old target here was unchanged in the window, so the shot was plain source, not a diff.
     */
    name: "folding",
    steps: [
      "Ctrl+P",
      'Type "layout/regions"',
      "Sleep 500ms",
      "Enter",
      "Sleep 1500ms",
      'Type "/"',
      "Sleep 300ms",
      'Type "function computeLayout"',
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
     * The tree docked to the right of the diff instead of the default left: `d` rotates it
     * clockwise, so two presses carry it left -> top -> right.
     */
    name: "pane-docking",
    steps: [
      openHeroDiff,
      'Type "d"',
      "Sleep 300ms",
      'Type "d"',
      "Sleep 1200ms",
    ].join("\n"),
  },
  {
    /**
     * The tree marking what an agent just touched. The settle waits out `RECENT_EDITS` (the last of
     * them lands ~17s after launch) and leaves each one a different age inside the 30s recency
     * window, so the dots read as a ramp rather than one flat state. `.` then jumps to the newest
     * of them.
     */
    name: "recent-activity",
    recentEdits: true,
    steps: ["Sleep 18s", 'Type "."', "Sleep 1500ms"].join("\n"),
  },
];

const tapeFor = (screen: (typeof screens)[number]) =>
  [
    `# ${screen.name}.png — generated by script/screenshots.ts`,
    header(),
    launchCmd(screen.launchEnv, screen.worktree === true ? WORKTREE_DIR : REPO),
    screen.steps,
    // Written next to the tape in the tmp dir (VHS's cwd), then moved into OUT.
    `Screenshot ${screen.name}.png`,
    "",
  ].join("\n\n");

const run = async (cmd: string, cmdArgs: string[], cwd = TAPES) => {
  const proc = Bun.spawn([cmd, ...cmdArgs], {
    cwd,
    stdio: ["inherit", "inherit", "inherit"],
  });

  const code = await proc.exited;

  if (code !== 0) {
    throw new Error(`${cmd} exited ${code}`);
  }
};

const shoot = async (screen: (typeof screens)[number]) => {
  if (screen.config === true) {
    await writeScreenshotConfig();
  }

  await Bun.write(`${TAPES}/${screen.name}.tape`, tapeFor(screen));
  console.log(`▶ ${screen.name}`);
  await run(VHS, [`${TAPES}/${screen.name}.tape`]);
  const png = `${OUT}/${screen.name}.png`;
  await Bun.write(png, Bun.file(`${TAPES}/${screen.name}.png`));

  if (OXIPNG !== null) {
    await run(OXIPNG, ["-o", "max", "--strip", "safe", png]);
  }
};

// Refuse to clobber a path this script did not create, and tear down only what it created.
let plantedImageFixture = false;

const writeImageFixture = async () => {
  if (existsSync(IMAGE_FIXTURE)) {
    throw new Error(
      `refusing to overwrite existing ${IMAGE_FIXTURE} (not created by this script)`
    );
  }

  // A real PNG (ffmpeg's test pattern) so the card reports honest dimensions and a plausible size,
  // Rather than a hand-built header. ffmpeg already ships with VHS, so it adds no new dependency.
  try {
    await run("ffmpeg", [
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=800x450",
      "-frames:v",
      "1",
      "-y",
      IMAGE_FIXTURE,
    ]);
  } catch (error) {
    // A failed run can leave a partial file behind; remove it so the ownership guard above does not
    // Refuse the next run. Flag ownership only after ffmpeg succeeds, so removeImageFixture (and its
    // Cleanup registration) stays aligned with a file this script actually created.
    rmSync(IMAGE_FIXTURE, { force: true });
    throw error;
  }

  plantedImageFixture = true;
};

const removeImageFixture = () => {
  if (!plantedImageFixture) {
    return;
  }

  rmSync(IMAGE_FIXTURE, { force: true });
  plantedImageFixture = false;
};

// Same ownership rule as the image fixture: refuse a path we did not create, tear down our own.
let plantedWorktree = false;

const addWorktree = async () => {
  if (existsSync(WORKTREE_DIR)) {
    throw new Error(
      `refusing to reuse existing ${WORKTREE_DIR} (not created by this script)`
    );
  }

  plantedWorktree = true;
  await run(
    "git",
    ["worktree", "add", "-b", WORKTREE_BRANCH, WORKTREE_DIR, "HEAD"],
    REPO
  );
};

// Sync like the other removers, so the signal handler can tear the worktree down before exit.
// `--force` for the worktree, `-D` for the branch it never merged.
const removeWorktree = () => {
  if (!plantedWorktree) {
    return;
  }

  Bun.spawnSync(["git", "worktree", "remove", "--force", WORKTREE_DIR], {
    cwd: REPO,
  });
  Bun.spawnSync(["git", "branch", "-D", WORKTREE_BRANCH], { cwd: REPO });
  plantedWorktree = false;
};

// Rewritten before every `config: true` shot rather than once per run, because the save-settings
// Tape presses `ctrl-s` and leaves the keys it wrote behind; a later shot must not inherit them.
const writeScreenshotConfig = async () => {
  await Bun.write(SCREENSHOT_CONFIG_FILE, SCREENSHOT_CONFIG);
  // `XDG_CONFIG_HOME` is not stet's alone: git resolves its own global config there too, and with it
  // `core.excludesFile`. A bare override drops the user's global ignores, so files they ignore
  // (`.claude/settings.local.json`) count as changed and this shot's tree and count disagree with
  // Every other one. Link the real git config back in so only stet's config moves.
  const realGitConfig = path.join(REAL_CONFIG_HOME, "git");
  const linked = path.join(SCREENSHOT_CONFIG_DIR, "git");

  if (existsSync(realGitConfig) && !existsSync(linked)) {
    symlinkSync(realGitConfig, linked, "dir");
  }
};

// Recursive, but `rmSync` unlinks the linked-in git config rather than descending into it.
const removeScreenshotConfig = () => {
  rmSync(SCREENSHOT_CONFIG_DIR, { force: true, recursive: true });
};

/**
 * Appends a marker line to each `RECENT_EDITS` file on its own delay, so stet's watcher observes a
 * real edit while it is running rather than finding one already there. Runs alongside the vhs
 * process; the caller awaits it before restoring, so no write can land after the restore.
 */
const plantedRecentEdits: { original: string; path: string }[] = [];

const applyRecentEdits = async () => {
  for (const edit of RECENT_EDITS) {
    // oxlint-disable-next-line no-await-in-loop -- the delays are cumulative by design
    await Bun.sleep(edit.afterMs);
    // oxlint-disable-next-line no-await-in-loop -- one edit's content is read after the last landed
    const original = await Bun.file(edit.path).text();
    plantedRecentEdits.push({ original, path: edit.path });
    // oxlint-disable-next-line no-await-in-loop -- sequential so each edit is a separate watcher tick
    await Bun.write(
      edit.path,
      `${original}\n// agent edit (screenshot fixture)\n`
    );
  }
};

// Sync like the other removers so the signal handler can reach it, and byte-exact so an interrupted
// Run leaves the checkout as it found it. Draining the list keeps a second call a no-op.
const restoreRecentEdits = () => {
  for (const edit of plantedRecentEdits.splice(0)) {
    writeFileSync(edit.path, edit.original);
  }
};

const only = new Set(Bun.argv.slice(2));

const unknown = [...only].filter(
  (name) => !screens.some((screen) => screen.name === name)
);

if (unknown.length > 0) {
  console.warn(
    `ignoring unknown screen name(s): ${unknown.join(", ")} — known: ${screens.map((screen) => screen.name).join(", ")}`
  );
}

if (OXIPNG === null) {
  console.warn(
    "oxipng not found — skipping lossless compression (brew install oxipng)"
  );
}

const wanted = screens.filter(
  (screen) => only.size === 0 || only.has(screen.name)
);

const standalone = wanted.filter(
  (screen) =>
    screen.worktree !== true &&
    screen.imageFixture !== true &&
    screen.recentEdits !== true
);

const worktreed = wanted.filter((screen) => screen.worktree === true);
const imageFixtured = wanted.filter((screen) => screen.imageFixture === true);
const recentEdited = wanted.filter((screen) => screen.recentEdits === true);

// One cleanup list drives both the finally and the signal handlers, so a Ctrl-C mid-shoot leaves
// Behind neither the temp config, the demo image, nor a source file the recency shot edited.
const cleanups: (() => void)[] = [];

const cleanup = () => {
  for (const remove of cleanups.splice(0)) {
    remove();
  }
};

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    cleanup();
    process.exit(130);
  });
}

try {
  // The config shots read a temp config via XDG_CONFIG_HOME, rewritten per shot inside `shoot`;
  // It creates no repo file, so it never pollutes another shot's tree. Only the teardown is global.
  if (wanted.some((screen) => screen.config === true)) {
    cleanups.push(removeScreenshotConfig);
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

  if (imageFixtured.length > 0) {
    // The untracked demo image would show in every other shot's tree, so plant it only now and
    // Tear it down through the shared cleanup.
    await writeImageFixture();
    cleanups.push(removeImageFixture);

    for (const screen of imageFixtured) {
      // oxlint-disable-next-line no-await-in-loop -- vhs spawns a headless terminal; runs must be sequential
      await shoot(screen);
    }
  }

  if (recentEdited.length > 0) {
    // Last, because these edits change real source files: their churn would show in any tree
    // Captured after them, and the recency they create would put stray dots on those rows too.
    // The edits run alongside vhs rather than before it, since stet has to be watching to see them.
    cleanups.push(restoreRecentEdits);
    // Both awaited together rather than starting the edits as a floating promise: a rejection while
    // Vhs is still running would otherwise go unhandled for the whole shot. Awaiting the edits here
    // Also guarantees no scheduled write lands after the cleanup has restored a file.
    await Promise.all([
      applyRecentEdits(),
      (async () => {
        for (const screen of recentEdited) {
          // oxlint-disable-next-line no-await-in-loop -- vhs spawns a headless terminal; runs must be sequential
          await shoot(screen);
        }
      })(),
    ]);
  }
} finally {
  cleanup();
}

console.log("done");
