import { existsSync } from "node:fs";
import nodePath from "node:path";

import { Effect, Queue, Stream } from "effect";
import {
  batch,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  on,
  onCleanup,
  untrack,
} from "solid-js";

import type { DiffScope, ScopeKind } from "./cli";
import { formatCopyReference } from "./clipboard/reference";
import { Clipboard } from "./clipboard/service";
import { BAR_SEP } from "./components/bar";
import { buildCommandMenuItems } from "./components/command-menu/items";
import type {
  CommandAction,
  CommandMenuInput,
} from "./components/command-menu/items";
import { Config } from "./config/service";
import { DiffEngine, languageForPath } from "./diff/engine";
import type { DiffRender } from "./diff/engine";
import { followScrollTop } from "./diff/follow";
import {
  applyCollapsedRegions,
  foldKey,
  foldRegionsFor,
  remapCursorAfterToggle,
} from "./diff/regions";
import type { DiffLineSide, DiffRow } from "./diff/rows";
import { firstWord, lastWord, nextWord, prevWord, wordAt } from "./diff/words";
import { openExternalCommand } from "./editor/reference";
import { Editor } from "./editor/service";
import { contentToContextPatch } from "./file/content";
import type { FileContent } from "./file/content";
import { File } from "./file/service";
import {
  directoryRecency,
  emptyActivityLog,
  lastChangedAt,
  latestActivity,
  RECENT_MS,
  recordActivity,
} from "./git/activity";
import type { ActivityEventKind, ActivityLog } from "./git/activity";
import type { BinaryDiff, DiffInput } from "./git/file-patch";
import type { Commit } from "./git/log";
import { changedPathsDiffer, mergeChanged } from "./git/model";
import type { ChangedFile, GitModel } from "./git/model";
import { filterPathspecs } from "./git/search";
import type { SearchMatch } from "./git/search";
import { Git } from "./git/service";
import { defaultExpandedDirectories, expandAncestorsForPath } from "./git/tree";
import {
  mergeWorktreeSummaries,
  orderWorktrees,
  PEER_SUMMARY_MS,
  WORKTREE_ACTIVE_MS,
  worktreePathTails,
} from "./git/worktree";
import type { Worktree, WorktreeSummary } from "./git/worktree";
import {
  computeLayout,
  horizontalDock,
  PANE_MIN_HEIGHT,
  PANE_MIN_WIDTH,
} from "./layout/regions";
import type { Dock } from "./layout/regions";
import type { LogLevel } from "./log/levels";
import { runtime } from "./runtime";
import {
  buildStatusBarModel,
  clearAlertSource,
  latestAlert,
  raiseAlert,
} from "./status/model";
import type {
  StatusAlert,
  StatusAlerts,
  StatusAlertSource,
} from "./status/model";
import {
  activeThemeName,
  activeZedTheme,
  appearance,
  selection,
  setSelection,
} from "./theme/active";
import { AUTO_THEME, themeNames } from "./theme/registry";
import type { ThemeSelection } from "./theme/registry";
import { createTreeModel } from "./tree/model";
import type { TreeMove } from "./tree/model";
import { worktreeLabel } from "./ui-helpers";
import { fetchLatestVersion, isNewer } from "./upgrade/release";
import { findMatches as findMatchIndices } from "./utils/find";
import { rankFiles } from "./utils/fuzzy";
import { refreshDelay } from "./utils/refresh-cadence";
import {
  back,
  canBack,
  canForward,
  currentLocation,
  forward,
  initialNav,
  navigate,
  recall,
  recordCurrent,
  remember,
} from "./viewer/navigation";
import type {
  JumpTarget,
  Location,
  NavState,
  Position,
} from "./viewer/navigation";
import { buildSearchItems, isNavigableSearchItem } from "./viewer/search-items";
import { Watcher } from "./watcher/service";

// The context the command menu was opened against; a clear effect closes the menu
// The moment any of it drifts, so the open state can never outlive the anchored
// Render (a click away moves the caret/focus and dismisses the menu). The tree menu
// Tracks its focused node and sidebar scroll, the viewer menu its caret and scroll.
interface CommandMenuGuard {
  context: "tree" | "viewer";
  focusedPane: "tree" | "diff" | "search";
  path: string | undefined;
  focusedNodeId: string;
  sidebarScrollTop: number;
  cursorIndex: number;
  cursorColumn: number;
  caretLineLevel: boolean;
  scrollTop: number;
  scrollX: number;
  scope: string;
  repoRoot: string;
}

interface PendingRestore extends Position {
  path: string;
}

// The coherent diff-pane snapshot, committed once per selection with its rows
// Already highlighted (the `highlights` backend tokenizes a 4k-line file in ~35ms,
// So there is no plain first pass to upgrade). The signal holds the previous
// Snapshot until the new one resolves, so the renderer never receives
// Empty/stale/partial content.
interface DiffView {
  path: string;
  full: boolean;
  showFileContent: boolean;
  fileContent: FileContent | undefined;
  render: DiffRender;
  // Present only for a changed binary file: its two sides' size/dimensions, so the
  // Viewer renders a metadata placeholder instead of the empty diff stet can't draw.
  binary?: BinaryDiff;
}

interface DiffBase {
  diff: DiffInput;
  fileContent: FileContent | undefined;
  showFileContent: boolean;
  binary?: BinaryDiff;
}

const DIFF_MAX_LINES = 1600;

// Bounds the search result list so a broad query in a large repo can't flood the
// Pane; hitting the cap sets `searchTruncated`, surfaced as a trailing "+".
const SEARCH_RESULT_CAP = 500;

// Lines of surrounding context shown on each side of a search match.
const SEARCH_CONTEXT_LINES = 2;

/**
 * Clockwise, so one press of the move key is a 90 degree turn to an adjacent edge and four presses
 * return the pane home. Keyed by every edge, so a new `Dock` is a compile error until it earns a
 * place in the rotation, the way `legend.ts` keys change kinds and stages.
 */
const NEXT_DOCK: Record<Dock, Dock> = {
  bottom: "left",
  left: "top",
  right: "bottom",
  top: "right",
};

const emptyModel: GitModel = {
  branch: undefined,
  changed: [],
  changedByPath: new Map(),
  repoFiles: [],
  repoFilesKey: "",
  repoRoot: "",
  scopeKey: "",
};

const loadDiffView = (src: {
  path: string;
  scope: DiffScope;
  showFile: boolean;
  full: boolean;
  file: ChangedFile | undefined;
  model: GitModel;
}): Effect.Effect<DiffView, never, File | Git | DiffEngine> => {
  const toView = (base: Effect.Effect<DiffBase, never, File | Git>) =>
    base.pipe(
      Effect.flatMap((result) =>
        DiffEngine.use((engine) =>
          engine.render({
            full: result.showFileContent || src.full,
            maxLines: DIFF_MAX_LINES,
            ...result.diff,
          })
        ).pipe(
          Effect.map((render): DiffView => ({
            binary: result.binary,
            fileContent: result.fileContent,
            full: src.full,
            path: src.path,
            render,
            showFileContent: result.showFileContent,
          }))
        )
      )
    );

  if (src.showFile) {
    const deletedSpec =
      src.scope.kind === "unstaged"
        ? `:${src.path}`
        : `${src.scope.ref}:${src.path}`;

    const gitSpec = src.file?.kind === "deleted" ? deletedSpec : undefined;

    return toView(
      File.use((file) =>
        file.content(src.model.repoRoot, src.path, { full: src.full, gitSpec })
      ).pipe(
        Effect.map((content): DiffBase => ({
          diff: {
            patch:
              content.kind === "text"
                ? contentToContextPatch(src.path, content.content)
                : "",
          },
          fileContent: content,
          showFileContent: true,
        }))
      )
    );
  }

  const { file } = src;

  if (file === undefined) {
    return toView(
      Effect.succeed<DiffBase>({
        diff: { patch: "" },
        fileContent: undefined,
        showFileContent: false,
      })
    );
  }

  // A binary file has no diff to draw, so skip the patch entirely and fetch the two
  // Sides' size/dimensions for the placeholder; `fileDiff` would only return "" here.
  if (file.binary) {
    return toView(
      Git.use((git) =>
        git.binaryMeta(src.model.repoRoot, src.scope, file)
      ).pipe(
        Effect.map((binary): DiffBase => ({
          binary,
          diff: { patch: "" },
          fileContent: undefined,
          showFileContent: false,
        })),
        // A `git show` failure still shows the designed binary surface (metadata just
        // Absent), never a blank pane, so a changed binary always reads as one. Scoped
        // To GitError so an unexpected defect still propagates.
        Effect.catchTag("GitError", () =>
          Effect.succeed<DiffBase>({
            binary: {},
            diff: { patch: "" },
            fileContent: undefined,
            showFileContent: false,
          })
        )
      )
    );
  }

  return toView(
    Git.use((git) => git.fileDiff(src.model.repoRoot, src.scope, file)).pipe(
      Effect.map((diff): DiffBase => ({
        diff,
        fileContent: undefined,
        showFileContent: false,
      })),
      Effect.catch(() =>
        Effect.succeed<DiffBase>({
          diff: { patch: "" },
          fileContent: undefined,
          showFileContent: false,
        })
      )
    )
  );
};

// Case-insensitive subsequence test (cmdk-style): every query char appears in
// Order in the target. An empty query matches everything.
const isSubsequence = (query: string, target: string) => {
  let i = 0;

  for (const char of target) {
    if (char === query[i]) {
      i += 1;
    }
  }

  return i === query.length;
};

// A windowed uniform-row list (the sidebar) renders only
// The rows inside [scrollTop, +viewport), so its renderable count is bounded
// By the viewport, not the content. This registers the shared glue: a follow
// Effect keeping the cursor framed (editor-style scrolloff) that tracks only
// The cursor, viewport, and gate, while rows and the current offset are read
// Untracked so a background refresh tick never snaps a wheel-scrolled window
// Back to the cursor; and a clamp effect bounding the window when the row
// List shrinks under it. The search pane deliberately does not use this: its
// Follow is action-driven (setSearchSelection), so a results update never
// Re-frames a wheel-scrolled window.
const followListWindow = (options: {
  cursor: () => number;
  viewport: () => number;
  rowCount: () => number;
  scrollTop: () => number;
  setScrollTop: (next: number) => void;
}) => {
  createEffect(() => {
    const top = options.cursor();
    const viewport = options.viewport();
    const current = untrack(options.scrollTop);

    const next = followScrollTop({
      current,
      height: 1,
      margin: 2,
      maxScroll: Math.max(0, untrack(options.rowCount) - viewport),
      top,
      viewport,
    });

    if (next !== current) {
      options.setScrollTop(next);
    }
  });
  createEffect(() => {
    const maxScroll = Math.max(0, options.rowCount() - options.viewport());

    if (untrack(options.scrollTop) > maxScroll) {
      options.setScrollTop(maxScroll);
    }
  });
};

// A thunk, not a memo: `themeNames()` reads the registry, which user themes are
// Registered into at startup *after* this root is created, so it must be read
// Lazily (when the picker opens), never captured once. `auto` maps to the
// Undefined selection (follow the terminal).
const themeComboboxItems = (): {
  name: string;
  selection: ThemeSelection;
}[] => [
  { name: AUTO_THEME, selection: undefined },
  ...themeNames().map((name) => ({ name, selection: name })),
];

// TextContent already stripped the single trailing newline, so a plain split
// Is line-exact: no phantom empty last line, and a genuine final blank line
// (a file ending in two newlines) is kept, since git grep can match on it.
const contentLines = (content: FileContent) =>
  content.kind === "text" ? content.content.split(/\r?\n/u) : undefined;

// Read each matched file once (bounded, never `full`) so results can show
// Context lines and feed the highlighter; a binary or oversized file yields no
// Lines and its matches degrade to grep-text-only rows.
const readSearchLines = async (
  root: string,
  matches: readonly SearchMatch[],
  signal: AbortSignal
) => {
  const paths = [...new Set(matches.map((match) => match.path))];

  return await runtime.runPromise(
    File.use((file) =>
      Effect.all(
        paths.map((path) =>
          file
            .content(root, path, { full: false })
            .pipe(
              Effect.map((content) => [path, contentLines(content)] as const)
            )
        ),
        // Bounded: a capped result set can still touch hundreds of files, and
        // Unbounded async reads would open that many descriptors at once.
        { concurrency: 16 }
      )
    ).pipe(
      Effect.map(
        (entries) =>
          new Map(
            entries.flatMap(([path, lines]) =>
              lines === undefined ? [] : [[path, lines] as const]
            )
          )
      )
    ),
    { signal }
  );
};

const isGapMarker = (row: DiffRow) =>
  row.kind === "marker" && row.regionKind === "gap";

// Save the current history entry and remember the position for a future reopen.
const recordLeaving = (nav: NavState, leaving: Location | undefined) =>
  leaving === undefined
    ? nav
    : remember(recordCurrent(nav, leaving), leaving.path, {
        cursorColumn: leaving.cursorColumn,
        cursorLine: leaving.cursorLine,
        cursorSide: leaving.cursorSide,
        jump: leaving.jump,
        viewport: leaving.viewport,
      });

/**
 * Creates the reactive state and actions for the git diff viewer.
 *
 * @returns The application state accessors, derived values, and actions
 */
const createState = () => {
  // Every signal below is created through `tracked`, which records how to restore that signal's
  // Initial value. `resetState` replays the lot, so the reset can never drift from the signals it
  // Resets. A hand-maintained reset list is what once let one test leak a toggle into every file
  // After it, failing unit tests on a signal they had never heard of. Tests are the only caller (the app
  // Owns one state for its whole life), so this is the seam that makes the singleton safe to share.
  // A signal is not the only thing that outlives a test. The async guards further down (an in-flight
  // Controller, a pending timer, a staleness token, a "what we last loaded for" marker) each pass
  // Their own teardown to `onReset` where they are declared, so an abandoned request can never
  // Resolve into the next test. Register at the declaration, never as one list here: a central list
  // Is exactly the drift this seam exists to remove.
  const resets: (() => void)[] = [];

  const onReset = (teardown: () => void) => {
    resets.push(teardown);
  };

  // A promise already in flight when a reset lands must not write its result into the next test. Most
  // Flows hold a controller the reset aborts, or a Solid owner that disposes them; the two that have
  // Neither (`checkForUpdate`, `refreshWorktreeSummaries`) capture this epoch before their await and
  // Drop the write if a reset moved it. Guarding only the reset boundary, rather than giving them a
  // Per-call token, leaves their concurrency exactly as it was: two summary refreshes racing is not a
  // Bug there, it is the design (the merge is monotonic, so both are meant to land).
  let resetEpoch = 0;
  onReset(() => {
    resetEpoch += 1;
  });

  const tracked = <T>(initial: T) => {
    const [read, write] = createSignal(initial);
    onReset(() => {
      write(() => initial);
    });

    return [read, write] as const;
  };

  const resetState = () => {
    batch(() => {
      for (const reset of resets) {
        reset();
      }
    });
  };

  // --- writable primitives ---
  const [scope, setScope] = tracked<DiffScope>({ kind: "all", ref: "HEAD" });
  // The CLI ref (default HEAD), the base for the all/staged scopes.
  const [cliBaseRef, setCliBaseRef] = tracked("HEAD");
  // Whether the base is the literal `HEAD` and HEAD names no commit yet, which is the one case
  // Where the base is not a diff endpoint. A ref the user named is never in this state: it still
  // Resolves on an orphan branch, and substituting it would silently show the wrong base.
  const [headUnborn, setHeadUnborn] = tracked(false);
  // This repository's empty tree, read from its object format by the startup preflight and seeded
  // Alongside repoRoot. Empty until then, like the other repo-identity signals, and every reader is
  // Downstream of the same load. Never a constant: the sha follows the repository's hash algorithm,
  // So a SHA-1 literal names an object a SHA-256 repository's database does not contain.
  const [emptyTree, setEmptyTree] = tracked("");
  // What `all` and `staged` actually diff against: the empty tree while HEAD is unborn, where every
  // Tracked file reads as added, and the CLI ref once a commit gives HEAD a meaning.
  const baseRef = createMemo(() => (headUnborn() ? emptyTree() : cliBaseRef()));
  // The SHA HEAD pointed at when stet launched, pinned for the session scope.
  const [sessionBase, setSessionBase] = tracked("HEAD");
  const [scopeMenuOpen, setScopeMenuOpen] = tracked(false);
  const [scopeMenuIndex, setScopeMenuIndex] = tracked(0);

  // The scope picker is two levels: the kinds list, and a drill-down into recent
  // Commits (each viewable as its own diff). `scopeMenuIndex` is reused per level.
  const [scopeMenuView, setScopeMenuView] = tracked<"kinds" | "commits">(
    "kinds"
  );

  const [commits, setCommits] = tracked<Commit[]>([]);

  const [commitsStatus, setCommitsStatus] = tracked<
    "loading" | "ready" | "empty" | "error"
  >("loading");

  // The commit pinned by the active `commit` scope (its subject drives the header
  // Label, so it survives even after the commit ages out of the reloaded list).
  const [selectedCommit, setSelectedCommit] = tracked<Commit | undefined>(
    undefined
  );

  // Wall-clock captured when the commits drill-down opens, for the rows' relative
  // Dates. Not `now` (the recency clock), which freezes while the repo is idle.
  const [commitsNow, setCommitsNow] = tracked(0);
  // The context menu: shared open/index state across the tree and viewer instances
  // (only one is ever open, gated by `commandMenuContext`). The anchor is the global
  // Terminal cell the tree menu opens at; the viewer instance derives its own from
  // The caret, so it stays undefined there.
  const [commandMenuOpen, setCommandMenuOpen] = tracked(false);
  const [commandMenuIndex, setCommandMenuIndex] = tracked(0);

  const [commandMenuContext, setCommandMenuContext] = tracked<
    "tree" | "viewer"
  >("tree");

  const [commandMenuAnchor, setCommandMenuAnchor] = tracked<
    { x: number; y: number } | undefined
  >(undefined);

  const [commandMenuGuard, setCommandMenuGuard] = tracked<
    CommandMenuGuard | undefined
  >(undefined);

  const [iconsEnabled, setIconsEnabled] = tracked(true);
  const [overflow, setOverflow] = tracked<"scroll" | "wrap">("scroll");
  const [changesOnly, setChangesOnly] = tracked(false);

  const [selectedPath, setSelectedPath] = tracked<string | undefined>(
    undefined
  );

  const [fileView, setFileView] = tracked(false);
  const [fullContentPaths, setFullContentPaths] = tracked(new Set<string>());
  // Viewer folds/gaps for the current file (reset on file switch): a `Set` of folded
  // Fold-region keys and a `Set` of expanded gap keys, both feeding `collapsedRender`.
  // Their opposite defaults (a fold starts open, a gap starts collapsed) are why they
  // Are two sets, not one; the transform that consumes them is shared.
  const [foldedRegions, setFoldedRegions] = tracked(new Set<string>());
  const [expandedGaps, setExpandedGaps] = tracked(new Set<string>());

  const [focusedPane, setFocusedPane] = tracked<"tree" | "diff" | "search">(
    "tree"
  );

  const [sidebarOpen, setSidebarOpen] = tracked(true);
  const [sidebarPosition, setSidebarPosition] = tracked<Dock>("left");

  // A pane keeps a size per axis: 50 columns is not 50 rows, so a move never converts,
  // And a size set on one edge is still there when the pane comes back to it.
  const [sidebarWidthOverride, setSidebarWidthOverride] = tracked<
    number | null
  >(null);

  const [sidebarHeightOverride, setSidebarHeightOverride] = tracked<
    number | null
  >(null);

  const [sidebarScrollTop, setSidebarScrollTop] = tracked(0);
  // Zoom follows focus rather than pinning a pane, so one boolean is the whole state:
  // `tab` moves which pane fills the screen with no rule of its own, and focus and
  // Visibility can never disagree.
  const [zoomed, setZoomed] = tracked(false);
  const [fileComboboxOpen, setFileComboboxOpen] = tracked(false);
  const [fileComboboxQuery, setFileComboboxQuery] = tracked("");
  const [fileComboboxIndex, setFileComboboxIndex] = tracked(0);
  // Which view occupies the main area. A union (not per-view booleans) so exactly
  // One view is ever active; future panes extend it.
  const [mainView, setMainView] = tracked<"file" | "search">("file");
  const [searchQuery, setSearchQuery] = tracked("");
  const [searchGlob, setSearchGlob] = tracked("");
  const [searchRegex, setSearchRegex] = tracked(false);
  const [searchCaseSensitive, setSearchCaseSensitive] = tracked(false);
  const [searchScope, setSearchScope] = tracked<"changed" | "repo">("changed");

  const [searchFocus, setSearchFocus] = tracked<"query" | "glob" | "results">(
    "query"
  );

  const [searchIndex, setSearchIndex] = tracked(0);
  const [searchScrollTop, setSearchScrollTop] = tracked(0);
  const [searchCollapsed, setSearchCollapsed] = tracked(new Set<string>());
  const [searchResults, setSearchResults] = tracked<SearchMatch[]>([]);

  const [searchFileLines, setSearchFileLines] = tracked(
    new Map<string, string[]>()
  );

  const [searchTruncated, setSearchTruncated] = tracked(false);

  const [searchStatus, setSearchStatus] = tracked<
    "idle" | "searching" | "ready" | "error"
  >("idle");

  const [findOpen, setFindOpen] = tracked(false);
  const [findActive, setFindActive] = tracked(false);
  const [findQuery, setFindQuery] = tracked("");
  const [findMatchPos, setFindMatchPos] = tracked(0);
  const [worktreeComboboxOpen, setWorktreeComboboxOpen] = tracked(false);
  const [worktreeComboboxIndex, setWorktreeComboboxIndex] = tracked(0);
  const [worktreeComboboxQuery, setWorktreeComboboxQuery] = tracked("");
  const [worktrees, setWorktrees] = tracked<Worktree[] | undefined>(undefined);

  // How much work sits in each worktree and when it last moved, keyed by worktree
  // Path. Repository-wide (not scoped to the active worktree), so a worktree switch
  // Leaves it valid. Written only by `refreshWorktreeSummaries`.
  const [worktreeSummaries, setWorktreeSummaries] = tracked<
    Map<string, WorktreeSummary>
  >(new Map());

  const [helpDialogOpen, setHelpDialogOpen] = tracked(false);
  const [helpView, setHelpView] = tracked<"keys" | "marks">("keys");
  const [quitConfirmOpen, setQuitConfirmOpen] = tracked(false);
  const [themeComboboxOpen, setThemeComboboxOpen] = tracked(false);
  const [themeComboboxIndex, setThemeComboboxIndex] = tracked(0);
  const [themeComboboxQuery, setThemeComboboxQuery] = tracked("");

  // The selection active when the picker opened, restored if the user cancels.
  const [themeComboboxOrigin, setThemeComboboxOrigin] =
    tracked<ThemeSelection>(undefined);

  const [gitModel, setGitModel] = tracked<GitModel>(emptyModel);
  const [repoRoot, setRepoRoot] = tracked("");
  // The repository's main worktree, resolved once at startup (repository-wide
  // Constant). It outlives a deleted linked worktree, so it is the recovery
  // Target; if it too is gone, the repository is gone and there is no survivor.
  const [mainWorktreePath, setMainWorktreePath] = tracked("");
  // Flips when the heartbeat finds the worktree deleted (its root or the main
  // Worktree gone); App reacts by switching to the main worktree or exiting.
  const [currentWorktreeDeleted, setCurrentWorktreeDeleted] = tracked(false);
  // Two timestamps that drive the adaptive safety-poll cadence: when git state
  // Last changed, and when the fs watcher last ticked (0 = never, i.e. unproven).
  const [lastChange, setLastChange] = tracked(0);
  const [lastWatcherTick, setLastWatcherTick] = tracked(0);
  const [cursorIndex, setCursorIndex] = tracked(0);
  // The in-line caret: a UTF-16 offset (a word start) on the cursor line. Motion
  // Hops word to word; a precise offset is still stored so a search jump lands
  // On its exact column and copy-reference can emit `:line:col`. Normalized to the
  // Line's first word whenever the cursor line or content changes (the Viewer
  // Effect), unless a restore/jump placed it on a valid word.
  const [cursorColumn, setCursorColumn] = tracked(0);
  // True when the caret selects a whole line, not a symbol on it (a click on the
  // Gutter): no word is highlighted and `y` copies `path:line`, not `path:line:col`.
  // Transient — any vertical move, word hop, jump, or content click re-selects a
  // Symbol, so it is never captured into navigation history.
  const [caretLineLevel, setCaretLineLevel] = tracked(false);

  // The fixed end of a line-range selection: a navIndex, or undefined when there
  // Is only a caret (today's behavior). The selection spans anchor..cursorIndex,
  // Whole-line. Transient like `caretLineLevel`: any plain caret move or navigation
  // Clears it (see `setCursorRow`/`goToLocation`), and it is never captured into
  // Navigation history. `C` copies the spanned lines' source text.
  const [selectionAnchor, setSelectionAnchor] = tracked<number | undefined>(
    undefined
  );

  /**
   * The viewer's scroll offsets, lifted out of DiffView so a navigation can capture and restore
   * them; DiffView projects `viewerScrollTop` onto the scrollbox whenever it changes (it stays the
   * single source of truth for the window).
   */
  const [viewerScrollTop, setViewerScrollTop] = tracked(0);
  const [viewerScrollX, setViewerScrollX] = tracked(0);
  // The viewer renders the live signals. History captures them on leave so
  // back/forward and fresh visits can restore the recorded position.
  const [navState, setNavState] = tracked<NavState>(initialNav(undefined));

  const [pendingRestore, setPendingRestore] = tracked<
    PendingRestore | undefined
  >(undefined);

  // Unresolved problems, tagged by the source that owns each one's lifecycle. A single untyped
  // Status channel was why a failed worktree list and a failed switch overwrote each other, and
  // Why either one's retry wiped the other's alert.
  const [alerts, setAlerts] = tracked<StatusAlerts>([]);

  /**
   * A live in-flight indicator for a worktree switch, which reloads the whole model: set on the
   * keystroke and cleared when the switch settles, distinct from the auto-clearing `notice`.
   */
  const [switchProgress, setSwitchProgress] = tracked<string | undefined>(
    undefined
  );

  const raise = (
    source: StatusAlertSource,
    level: StatusAlert["level"],
    text: string
  ) => {
    setAlerts((current) => raiseAlert(current, { level, source, text }));
  };

  const clearAlert = (source: StatusAlertSource) => {
    setAlerts((current) => clearAlertSource(current, source));
  };

  // An ephemeral acknowledgment of a user action (copied, scope changed, …),
  // Held for a fixed dwell so it outlives the keystroke that triggered it.
  const [notice, setNotice] = tracked<
    { text: string; level: LogLevel } | undefined
  >(undefined);

  // Set by the background release check; read once on quit to print the post-exit notice.
  const [availableUpdate, setAvailableUpdate] = tracked<
    { current: string; latest: string } | undefined
  >(undefined);

  const [activityLog, setActivityLog] = tracked<ActivityLog>(emptyActivityLog);
  const [now, setNow] = tracked(Date.now());
  const [terminalWidth, setTerminalWidth] = tracked(80);
  const [terminalHeight, setTerminalHeight] = tracked(24);
  /**
   * True while stet has handed the terminal to another program (the terminal editor). OpenTUI
   * rejects terminal controls such as the title while suspended, so a terminal-control effect skips
   * its write here and re-runs when the flag clears, landing whatever changed in the meantime.
   */
  const [terminalSuspended, setTerminalSuspended] = tracked(false);

  const [editorTemplate, setEditorTemplate] =
    tracked<string>("vim +{line} {file}");

  const [ideTemplate, setIdeTemplate] = tracked<string | undefined>(undefined);
  // The raw --editor/--ide flags from this run's command line, kept apart from the
  // Resolved templates above: ctrl-s persists only a literal flag, never the
  // Resolution (which folds in STET_EDITOR/$EDITOR/$VISUAL and the vim fallback,
  // And would freeze an environment-derived default into the user's file).
  const [editorFlag, setEditorFlag] = tracked<string | undefined>(undefined);
  const [ideFlag, setIdeFlag] = tracked<string | undefined>(undefined);

  // --- synchronous derived ---
  const selectedFile = createMemo(() => {
    const path = selectedPath();

    return path === undefined ? undefined : gitModel().changedByPath.get(path);
  });

  const showFileContent = createMemo(
    () =>
      selectedPath() !== undefined &&
      (selectedFile() === undefined || fileView())
  );

  const repoFiles = createMemo(() => gitModel().repoFiles);

  const changedPaths = createMemo(
    () => new Set(gitModel().changedByPath.keys()),
    undefined,
    {
      equals: (previous, next) =>
        previous.size === next.size && previous.isSubsetOf(next),
    }
  );

  // Paths absent from repoFiles but present in changedPaths: staged deletions only. Narrower
  // Than changedPaths so the O(repoFiles) structure walk is skipped on content-only edits.
  const repoFilePaths = createMemo(
    () => new Set(repoFiles().map((f) => f.path))
  );

  const stagedDeletionPaths = createMemo(
    () => {
      // Until repoFiles loads (deferred poll, empty key) every changed path looks
      // "Absent from repoFiles", which would render the whole changed set as the
      // Default tree and then re-render the full tree, a visible jump. A deletion is
      // Only knowable once repoFiles exists, so report none until then.
      if (gitModel().repoFilesKey === "") {
        return new Set<string>();
      }

      const filePaths = repoFilePaths();

      return new Set([...changedPaths()].filter((p) => !filePaths.has(p)));
    },
    undefined,
    {
      equals: (previous, next) =>
        previous.size === next.size && previous.isSubsetOf(next),
    }
  );

  const treeFiles = createMemo(() => {
    // With nothing changed, changes-only would leave an empty tree, so it shows every file
    // Until a change lands; the header's changed count says why.
    const narrowed = changesOnly() && changedPaths().size > 0;
    const paths = narrowed ? changedPaths() : stagedDeletionPaths();

    const files = new Map(
      repoFiles()
        .values()
        .filter((file) => !narrowed || paths.has(file.path))
        .map((file) => [file.path, file] as const)
    );

    for (const path of paths) {
      if (!files.has(path)) {
        files.set(path, { path, symlink: false, tracked: true });
      }
    }

    return files;
  });

  const [treeGeneration, setTreeGeneration] = createSignal(0);
  onReset(() => {
    setTreeGeneration((generation) => generation + 1);
  });
  const [treeRevision, setTreeRevision] = tracked(0);
  const treeRoot = createMemo(() => gitModel().repoRoot);

  const treeModel = createMemo(() => {
    treeRoot();
    treeGeneration();
    const model = createTreeModel();

    const unsubscribe = model.subscribe(() => {
      setTreeRevision((revision) => revision + 1);
    });

    onCleanup(() => {
      unsubscribe();
      model.cleanUp();
    });

    return model;
  });

  const treeTopology = createMemo(
    () => {
      const model = treeModel();
      model.syncPaths(treeFiles());

      return model;
    },
    undefined,
    { equals: false }
  );

  const decoratedTree = createMemo(
    () => {
      const model = treeTopology();
      model.setChanges(gitModel().changedByPath);

      return model;
    },
    undefined,
    { equals: false }
  );

  const setExpandedDirectories = (expanded: Set<string>) => {
    treeTopology().setExpanded(expanded);
  };

  const focusTreeNode = (id: string) => {
    treeTopology().focus(id);
  };

  const toggleTreeNode = (id: string) => {
    treeTopology().toggle(id);
  };

  const treeRowCount = () => {
    const model = treeTopology();
    treeRevision();

    return model.rowCount();
  };

  const treeSlice = (start: number, height: number) => {
    decoratedTree();
    const model = treeTopology();
    treeRevision();

    return model.rows(start, height);
  };

  const focusedRowIndex = createMemo(() => {
    const model = treeTopology();
    treeRevision();

    return model.focusedIndex();
  });

  const focusedTreeRow = () => treeSlice(focusedRowIndex(), 1)[0];
  const focusedNodeId = () => focusedTreeRow()?.node.id ?? "";

  followListWindow({
    cursor: focusedRowIndex,
    rowCount: treeRowCount,
    scrollTop: sidebarScrollTop,
    setScrollTop: (next) => {
      setSidebarScrollTop(next);
    },
    // A thunk, not the memo itself: `layout` is declared later in this root,
    // And the effects only run after the whole root body has executed.
    viewport: () => layout().sidebar.content.height,
  });

  // The default tree is the whole repo, so it stays empty until the deferred
  // RepoFiles poll fills it. parseRepoFiles always folds repoRoot into the key, so
  // A loaded 0-file repo has a non-empty key: an empty key means "not loaded yet"
  // (including the pre-startup empty model), and the default tree reserves blank
  // Space for that window instead of flashing the empty state.
  const repoFilesLoading = createMemo(() => gitModel().repoFilesKey === "");
  const recencyByPath = createMemo(() => lastChangedAt(activityLog()));

  // Per-directory aggregates, one pass each, so collapsed directory rows do O(1)
  // Lookups instead of scanning every entry per row per render.
  const directoryRecencyByPath = createMemo(() =>
    directoryRecency(recencyByPath())
  );

  // The go-to-file universe: repoFiles plus changed-only paths (staged
  // Deletions), the same universe the tree renders. Every dependency is
  // Identity-gated (`repoFiles` is reference-stable across content edits,
  // `changedPaths` set-equality-gated), so a content-only refresh tick never
  // Rebuilds this array while the picker is open.
  const fileComboboxPaths = createMemo(() => {
    const filePaths = repoFilePaths();

    return [
      ...repoFiles().map((file) => file.path),
      ...[...changedPaths()].filter((path) => !filePaths.has(path)),
    ];
  });

  // The rank context is snapshotted when the picker opens, so a background
  // Refresh never re-ranks (and never reorders) the list under the cursor while
  // It is open; the universe above stays live, so a file created mid-open still
  // Appears. Per-row decorations (recency dot, changed tint) keep reading live
  // State.
  const [fileComboboxRankContext, setFileComboboxRankContext] = tracked({
    changed: new Set<string>(),
    lastChangedAt: new Map<string, number>(),
  });

  const openFileCombobox = () => {
    batch(() => {
      setFileComboboxRankContext({
        changed: untrack(changedPaths),
        lastChangedAt: untrack(recencyByPath),
      });
      setFileComboboxQuery("");
      setFileComboboxIndex(0);
      setFileComboboxOpen(true);
    });
  };

  const fileComboboxResults = createMemo(() => {
    if (!fileComboboxOpen()) {
      return [];
    }

    return rankFiles(fileComboboxQuery(), fileComboboxPaths(), {
      ...fileComboboxRankContext(),
      limit: 50,
    });
  });

  // `themeNames()` tracks the registry, so the list picks up themes registered
  // After this root (user files, bundled themes landing) while still tracking
  // `themeComboboxQuery` for the reactive scopes that read it.
  const themeComboboxResults = () => {
    const query = themeComboboxQuery().toLowerCase();

    return themeComboboxItems().filter((item) =>
      isSubsequence(query, item.name.toLowerCase())
    );
  };

  // `undefined` while the worktree list is still loading (so the picker keeps its
  // Loading state); otherwise the subsequence-filtered list, matching the branch
  // Label and the path's distinguishing tail so a query can narrow by either. The
  // Prefix the worktrees share is deliberately not in the haystack: it is the same
  // Text in every row, so it can only ever match all of them at once.
  const worktreeComboboxResults = createMemo(() => {
    const list = worktrees();

    if (list === undefined) {
      return list;
    }

    const query = worktreeComboboxQuery().toLowerCase();

    if (query === "") {
      return list;
    }

    const tails = worktreePathTails(list);

    return list.filter((worktree) =>
      isSubsequence(
        query,
        `${worktreeLabel(worktree)} ${tails.get(worktree.path) ?? ""}`.toLowerCase()
      )
    );
  });

  // --- coherent diff-pane snapshot (the freeze fix) ---
  const diffSource = createMemo(() => {
    const path = selectedPath();

    if (path === undefined) {
      return path;
    }

    return {
      file: selectedFile(),
      full: fullContentPaths().has(path),
      model: gitModel(),
      path,
      scope: scope(),
      showFile: showFileContent(),
    };
  });

  const [diffView, setDiffView] = tracked<DiffView | undefined>(undefined);
  createEffect(() => {
    // Re-run on a theme change too (a runtime appearance flip), so the diff
    // Re-renders with the new palette; the engine keys its cache by the theme.
    activeZedTheme();
    const src = diffSource();

    if (src === undefined) {
      setDiffView(undefined);

      return;
    }

    const controller = new AbortController();
    const { signal } = controller;

    const load = async () => {
      try {
        const view = await runtime.runPromise(loadDiffView(src), { signal });

        // The controller can abort after the load resolved but before this
        // Microtask drains; committing then would paint a stale snapshot over the
        // Fresh one, so only the live selection lands.
        if (signal.aborted) {
          return;
        }

        setDiffView(view);
      } catch {
        // An aborted or failed load keeps the previous snapshot showing.
      }
    };

    void load();
    onCleanup(() => {
      controller.abort();
    });
  });

  // Project content search: debounced git grep over the changed set (honoring the
  // Active scope, since `changed` already reflects it), the whole repo, or the
  // Glob pathspecs. The snapshot (results + file lines + truncation) commits as
  // One batch and holds until the next query resolves; cleanup aborts the prior
  // Grep and cancels a not-yet-fired keystroke, the same restart-on-rekey pattern
  // As the diff pipeline. Leaving the search view returns early *without*
  // Clearing, so toggling back restores the results with no flash.
  const SEARCH_DEBOUNCE_MS = 120;
  createEffect(() => {
    if (mainView() !== "search") {
      return;
    }

    const query = searchQuery();
    const root = repoRoot();

    const options = {
      caseSensitive: searchCaseSensitive(),
      regex: searchRegex(),
    };

    const globTokens = filterPathspecs(searchGlob());
    // Track the git model itself (not the set-equal `changedPaths` memo, and in
    // Every scope): a content-only edit to an already-changed file keeps the
    // Path-set identical but moves matches and line numbers, so the grep must
    // Re-run on each model commit or results, context, and jump targets go
    // Stale against the working tree, the agent-edits-while-you-watch core
    // Scenario.
    const model = gitModel();

    const changedScopePaths =
      searchScope() === "changed"
        ? model.changed.map((file) => file.path)
        : undefined;

    if (query === "" || root === "") {
      batch(() => {
        setSearchResults([]);
        setSearchFileLines(new Map());
        setSearchTruncated(false);
        setSearchStatus("idle");
      });

      return;
    }

    if (
      changedScopePaths !== undefined &&
      changedScopePaths.length === 0 &&
      globTokens === undefined
    ) {
      batch(() => {
        setSearchResults([]);
        setSearchFileLines(new Map());
        setSearchTruncated(false);
        setSearchStatus("ready");
      });

      return;
    }

    // A glob narrows via pathspecs; under the changed scope the glob drives the
    // Grep and the changed set filters after (pathspecs union, never intersect).
    const paths = globTokens ?? changedScopePaths;

    const changedSet =
      globTokens !== undefined && changedScopePaths !== undefined
        ? new Set(changedScopePaths)
        : undefined;

    setSearchStatus("searching");
    const controller = new AbortController();

    const runSearch = async () => {
      try {
        const all = await runtime.runPromise(
          Git.use((git) => git.search(root, query, paths, options)),
          { signal: controller.signal }
        );

        const inScope =
          changedSet === undefined
            ? all
            : all.filter((match) => changedSet.has(match.path));

        const matches = inScope.slice(0, SEARCH_RESULT_CAP);

        const linesByPath = await readSearchLines(
          root,
          matches,
          controller.signal
        );

        // Drop a superseded query's results: a search can resolve just as a newer
        // Keystroke aborts its controller, so guard the write the same way.
        if (controller.signal.aborted) {
          return;
        }

        batch(() => {
          setSearchResults(matches);
          setSearchFileLines(linesByPath);
          setSearchTruncated(inScope.length > SEARCH_RESULT_CAP);
          setSearchStatus("ready");
        });
      } catch {
        // A genuine grep failure (a half-typed regex) keeps the prior results in
        // Place under an error status, so an unfinished pattern never blanks the
        // Pane; our own cancellation (the aborted controller) changes nothing.
        if (!controller.signal.aborted) {
          setSearchStatus("error");
        }
      }
    };

    const timer = setTimeout(() => {
      void runSearch();
    }, SEARCH_DEBOUNCE_MS);

    onCleanup(() => {
      clearTimeout(timer);
      controller.abort();
    });
  });

  const searchItems = createMemo(() =>
    buildSearchItems({
      collapsed: searchCollapsed(),
      context: SEARCH_CONTEXT_LINES,
      linesByPath: searchFileLines(),
      matches: searchResults(),
    })
  );

  // Move the selection and keep it in the results viewport, mirroring the diff
  // Cursor's follow-scroll (margin rows of context, never glued to the edge).
  const setSearchSelection = (index: number) => {
    batch(() => {
      setSearchIndex(index);
      setSearchScrollTop(
        followScrollTop({
          current: searchScrollTop(),
          height: 1,
          margin: 2,
          maxScroll: Math.max(0, searchItems().length - searchListHeight()),
          top: index,
          viewport: searchListHeight(),
        })
      );
    });
  };

  // Hop the selection to the next/previous navigable row (matches and file
  // Headers), skipping context lines and gaps.
  const moveSearchSelection = (direction: number) => {
    const items = searchItems();
    const current = searchIndex();

    const next =
      direction > 0
        ? items.findIndex(
            (item, index) => index > current && isNavigableSearchItem(item)
          )
        : items.findLastIndex(
            (item, index) => index < current && isNavigableSearchItem(item)
          );

    if (next !== -1) {
      setSearchSelection(next);
    }
  };

  // Half-page the selection by *visual* rows (the viewport unit ctrl-d/ctrl-u
  // Promise), then snap to the nearest navigable row in the travel direction;
  // Counting navigable hops instead would overshoot by each match's context
  // Rows and headers.
  const pageSearchSelection = (direction: number) => {
    const items = searchItems();
    const step = Math.max(1, Math.floor(searchListHeight() / 2)) * direction;

    const target = Math.max(
      0,
      Math.min(searchIndex() + step, items.length - 1)
    );

    const snapped =
      direction > 0
        ? items.findIndex(
            (item, index) => index >= target && isNavigableSearchItem(item)
          )
        : items.findLastIndex(
            (item, index) => index <= target && isNavigableSearchItem(item)
          );

    const fallback =
      direction > 0
        ? items.findLastIndex(isNavigableSearchItem)
        : items.findIndex(isNavigableSearchItem);

    const landed = snapped === -1 ? fallback : snapped;

    if (landed !== -1) {
      setSearchSelection(landed);
    }
  };

  // Keep the selection on a navigable row as the item list changes underneath it
  // (new results, a collapse, a filter), and the scroll inside shrunken content.
  createEffect(() => {
    const items = searchItems();
    const index = untrack(searchIndex);
    const item = items[index];

    if (item === undefined || !isNavigableSearchItem(item)) {
      const bounded = Math.min(index, items.length - 1);

      const previous = items.findLastIndex(
        (candidate, candidateIndex) =>
          candidateIndex <= bounded && isNavigableSearchItem(candidate)
      );

      setSearchIndex(
        previous === -1
          ? Math.max(0, items.findIndex(isNavigableSearchItem))
          : previous
      );
    }

    const maxScroll = Math.max(0, items.length - searchListHeight());

    if (untrack(searchScrollTop) > maxScroll) {
      setSearchScrollTop(maxScroll);
    }
  });

  const openSearch = () => {
    batch(() => {
      setMainView("search");
      setFocusedPane("search");
      setSearchFocus("query");
    });
  };

  // Closing the view keeps every search signal (query, snapshot, selection,
  // Collapsed groups): persistence across jumps is the point of the pane.
  const closeSearch = () => {
    batch(() => {
      setMainView("file");

      if (focusedPane() === "search") {
        setFocusedPane("diff");
      }
    });
  };

  const jumpToSearchItem = (index: number) => {
    const item = searchItems()[index];

    if (item === undefined || item.kind !== "line") {
      return;
    }

    batch(() => {
      setSearchIndex(index);
      selectFile(item.path, {
        column: item.match?.column,
        escalate: true,
        line: item.line,
      });
    });
  };

  const resetSearchSelection = () => {
    batch(() => {
      setSearchIndex(0);
      setSearchScrollTop(0);
    });
  };

  const toggleSearchRegex = () => {
    setSearchRegex((enabled) => !enabled);
    resetSearchSelection();
  };

  const toggleSearchCase = () => {
    setSearchCaseSensitive((enabled) => !enabled);
    resetSearchSelection();
  };

  const toggleSearchScope = () => {
    setSearchScope((current) => (current === "changed" ? "repo" : "changed"));
    resetSearchSelection();
  };

  const toggleSearchGroup = (path: string) => {
    batch(() => {
      setSearchCollapsed((current) => {
        const next = new Set(current);

        if (!next.delete(path)) {
          next.add(path);
        }

        return next;
      });

      const header = searchItems().findIndex(
        (item) => item.kind === "header" && item.path === path
      );

      if (header !== -1) {
        setSearchSelection(header);
      }
    });
  };

  // Search results are repo-specific paths: a worktree switch (or the deleted-
  // Worktree recovery) invalidates them. Clear the snapshot but keep the query.
  createEffect(
    on(
      repoRoot,
      () => {
        batch(() => {
          setSearchResults([]);
          setSearchFileLines(new Map());
          setSearchTruncated(false);
          setSearchStatus("idle");
          setSearchCollapsed(new Set<string>());
          resetSearchSelection();
        });
      },
      { defer: true }
    )
  );

  // Fold by structure: markdown files fold by heading section, everything else by
  // Indentation. The same `languageForPath` the highlighter uses, so the fold model
  // Agrees with the rendered language.
  const foldMode = () => {
    const language = languageForPath(diffView()?.path ?? "");

    return language === "markdown" || language === "mdx"
      ? "markdown"
      : "indent";
  };

  // The render laid out for the expanded gaps: the engine's renderer reveals each
  // Expanded gap's (highlighted) lines and heads them with a "hide" marker.
  const expandedLayout = createMemo(() =>
    diffView()?.render.expand(expandedGaps())
  );

  // The single "collapsed regions" transform: the expanded layout folded for the
  // Current state. `navigableLines` and the viewer's rows both read it, so the caret
  // Indexes only visible lines and can never land inside a collapsed region. Keyed on
  // The fold/gap sets (not the caret), so cursor moves don't recompute it.
  // `truncated`/`truncatedHidden` stay on the raw `render` deliberately: the maxLines
  // Cap is about the whole file, not what the user folded away.
  const collapsedRender = createMemo(() =>
    applyCollapsedRegions(expandedLayout()?.rows ?? [], {
      folded: foldedRegions(),
      mode: foldMode(),
    })
  );

  const navigableLines = createMemo(() => collapsedRender().navigable);
  const viewerRows = () => collapsedRender().rows;

  // The navigable list for a hypothetical fold/gap state, so a toggle can remap the
  // Caret against the next lines within one synchronous batch (no memo-timing race).
  const collapsedNavigableFor = (
    folded: ReadonlySet<string>,
    gaps: ReadonlySet<string>
  ) =>
    applyCollapsedRegions(diffView()?.render.expand(gaps).rows ?? [], {
      folded,
      mode: foldMode(),
    }).navigable;

  // Folds shrink `navigableLines`, so the caret can end up past its end; the Viewer's
  // Existing cursor clamp (keyed on `navigableLines().length`) already re-homes it.
  const truncated = createMemo(() => {
    const content = diffView()?.fileContent;

    return (
      (diffView()?.render.hiddenLines ?? 0) > 0 ||
      (content?.kind === "text" && content.truncated)
    );
  });

  // Line rows the cap hid, for the "N more lines" footer. In file-content mode the
  // True total is the file's own line count (the render is built from an
  // Already-capped slice), so measure the hidden count against what's shown; a diff
  // Has no larger total, so its own dropped-row count is exact.
  const truncatedHidden = createMemo(() => {
    const view = diffView();

    if (view === undefined) {
      return 0;
    }

    const content = view.fileContent;

    if (content?.kind === "text" && content.truncated) {
      return Math.max(0, content.lineCount - view.render.navigable.length);
    }

    return view.render.hiddenLines;
  });

  // In-buffer find: row indices into navigableLines whose content matches the
  // Query. Computed only while the bar is open or a search is committed, so the
  // Viewer paints highlights live as you type and keeps them until esc/file switch.
  const findMatches = createMemo(() =>
    findOpen() || findActive()
      ? findMatchIndices(
          navigableLines().map((line) => line.content),
          findQuery()
        )
      : []
  );

  // The one reset for find lifecycle (close, clear, file switch all share it).
  const resetFind = () => {
    setFindOpen(false);
    setFindActive(false);
    setFindQuery("");
    setFindMatchPos(0);
  };

  // An open find bar owns the keyboard, so it may only stay open while the viewer holds focus:
  // Otherwise another pane looks focused while typing still goes into find. Closing it here
  // Covers every path that moves focus (a click on a tree row or the tree pane, or any future
  // Focus change), as esc would.
  createEffect(
    on(focusedPane, (pane) => {
      if (pane !== "diff" && findOpen()) {
        resetFind();
      }
    })
  );

  // A file switch ends any active find so highlights never bleed across files.
  createEffect(
    on(selectedPath, () => {
      batch(resetFind);
    })
  );

  // Folds/gaps are per file (the #181 v1 decision): a file switch clears them, so a
  // Returned-to file opens fully expanded. A scope change clears them too, since the
  // Gap keys (`gap:N`, the hunk a gap precedes) are scope-relative, so keeping them
  // Could reveal a different stretch of the next scope's diff.
  const resetFolds = () => {
    setFoldedRegions(new Set<string>());
    setExpandedGaps(new Set<string>());
  };

  createEffect(
    on(selectedPath, () => {
      batch(resetFolds);
    })
  );
  createEffect(
    on(scope, () => {
      batch(resetFolds);
    })
  );

  // Live theme preview: while the picker is open, the highlighted row is the
  // Active selection, so moving (keys, hover, wheel) or filtering re-themes the
  // Whole UI and re-highlights the diff instantly through the one reactive seam.
  // It only writes while open; cancel/commit are handled by closeThemePicker.
  createEffect(() => {
    if (!themeComboboxOpen()) {
      return;
    }

    const item = themeComboboxResults()[themeComboboxIndex()];
    setSelection(item === undefined ? themeComboboxOrigin() : item.selection);
  });

  // --- layout ---
  // Terminal dimensions become pane geometry in exactly one place, `computeLayout`.
  // Renderers read a rect off this record; none re-derives its own budget from the
  // Terminal size, which is why there is no `sidebarWidth`/`paneHeight` accessor to
  // Subtract from. Zoom is still a model input with no signal behind it.
  const zoomTarget = () => (focusedPane() === "tree" ? "tree" : "viewer");

  const layout = createMemo(() =>
    computeLayout({
      sidebar: {
        heightOverride: sidebarHeightOverride(),
        open: sidebarOpen(),
        position: sidebarPosition(),
        widthOverride: sidebarWidthOverride(),
      },
      terminalHeight: terminalHeight(),
      terminalWidth: terminalWidth(),
      // Zoom follows focus, and needs no open-flag check of its own because focus never names
      // A closed pane: every writer either targets the viewer, sits on the tree while it is
      // Mounted, or routes through `focusNextPane`/`collapseSidebar`, which each land only on
      // Something open. The map is still a map, not an identity: the search view is a second
      // Focus value for the one viewer slot.
      zoom: zoomed() ? zoomTarget() : undefined,
    })
  );

  // A truncated file reserves one row for the "N more lines" footer, so the diff
  // Content shrinks by it; DiffView derives its whole windowing from this height,
  // So the single subtraction keeps the slice and scroll math correct. Chrome the
  // Viewer owns inside its own rect stays here rather than in the pure model.
  const viewerHeight = createMemo(() =>
    Math.max(1, layout().viewer.content.height - 1 - (truncated() ? 1 : 0))
  );

  // The search view's results band: the pane interior minus its four fixed chrome
  // Rows (query, filter, summary, footer). Fixed chrome, so no state ever shifts it.
  const searchListHeight = createMemo(() =>
    Math.max(1, layout().viewer.content.height - 4)
  );

  // The viewer is one pane holding two views, so "focus the viewer" is whichever the main
  // Area shows. Every path that lands focus there without already knowing the view reads it
  // From here; the two that still name "diff" outright (`closeSearch`, and the keymap opening
  // Find) do so because `mainView` is provably "file" there, not as a shortcut.
  const viewerFocus = () => (mainView() === "search" ? "search" : "diff");

  // Closing the sidebar moves focus off the now-hidden tree so keys still land
  // Somewhere, on whichever view the main area shows; the `ctrl-b` toggle and a
  // Shrink-past-minimum share this one path.
  const collapseSidebar = () => {
    if (focusedPane() === "tree") {
      setFocusedPane(viewerFocus());
    }

    setSidebarOpen(false);
  };

  const toggleSidebar = () => {
    // Opening or closing a pane is a visibility change, and zoom's premise is that only
    // The focused pane is visible, so it exits first; otherwise the toggle would land
    // Invisibly behind the zoom and surprise on the way out. `tab` only moves focus, so
    // It carries the zoom instead.
    setZoomed(false);

    if (sidebarOpen()) {
      collapseSidebar();
    } else {
      setSidebarOpen(true);
    }
  };

  // `tab` switches between the tree and the viewer, landing on the tree only while it is open, so
  // Focus can never name a pane the user closed and the zoom that follows it can never paint one
  // Back. Open, not painted, is the test, because zoom hides the tree without closing it and `tab`
  // Carries the zoom along rather than being trapped in whatever it lit up.
  const focusNextPane = () =>
    setFocusedPane(
      focusedPane() !== "tree" && sidebarOpen() ? "tree" : viewerFocus()
    );

  // The sizable pane's accessors as one shape. Nothing new is stored: every field is a signal
  // Declared above.
  const sidebarPane = {
    collapse: collapseSidebar,
    heightOverride: sidebarHeightOverride,
    open: sidebarOpen,
    position: sidebarPosition,
    rect: () => layout().sidebar,
    setHeightOverride: setSidebarHeightOverride,
    setOpen: setSidebarOpen,
    setPosition: setSidebarPosition,
    setWidthOverride: setSidebarWidthOverride,
    widthOverride: sidebarWidthOverride,
  };

  type SizablePane = typeof sidebarPane;

  // Which axis a nudge steps on, which floor it stops at, and which override holds the
  // Extent all come from the pane's *current edge*, never its identity: a top-docked tree
  // Resizes in rows against PANE_MIN_HEIGHT. The step is per axis too, since a terminal cell
  // Is taller than it is wide, so two columns read as about one row.
  const sizingAxis = (pane: SizablePane) =>
    horizontalDock(pane.position())
      ? {
          extent: () => pane.rect().width,
          min: PANE_MIN_WIDTH,
          override: pane.widthOverride,
          setOverride: pane.setWidthOverride,
          step: 2,
        }
      : {
          extent: () => pane.rect().height,
          min: PANE_MIN_HEIGHT,
          override: pane.heightOverride,
          setOverride: pane.setHeightOverride,
          step: 1,
        };

  // Nudges seed from the current rendered extent on first use so the step is relative to
  // What's on screen, not a stale override. Shrinking past the minimum closes the pane
  // Rather than clamping, like an IDE pane; growing a closed one re-opens it at its
  // Remembered extent, the exact inverse of that shrink.
  const nudgePane = (pane: SizablePane, direction: -1 | 1) => {
    if (zoomed()) {
      return;
    }

    if (!pane.open()) {
      if (direction > 0) {
        pane.setOpen(true);
      }

      return;
    }

    const axis = sizingAxis(pane);
    const next = (axis.override() ?? axis.extent()) + direction * axis.step;

    if (next < axis.min) {
      pane.collapse();

      return;
    }

    axis.setOverride(next);
  };

  // The tree is the one sizable pane. The viewer is whatever the dock leaves, so it has
  // No size of its own and the keys act on the sidebar from it too. Zoom is a temporary "show only this" mode, so every geometry key is inert until it
  // Clears: resizing a pane that already fills the screen means nothing, and the others
  // Are hidden without being closed, so a write there would land invisibly.
  const toggleZoom = () => setZoomed((zoom) => !zoom);

  const growPane = () => {
    nudgePane(sidebarPane, 1);
  };

  const shrinkPane = () => {
    nudgePane(sidebarPane, -1);
  };

  // Only the docked axis resets, so a left-docked tree's `\` never wipes a height set
  // While it was on top, which is what makes a four-press round trip idempotent. A closed
  // Pane ignores it, like `nudgePane`: otherwise `\` reached past a collapsed tree (the
  // Keys fall back to it from the viewer) and silently discarded the width `]` reopens at.
  const resetPane = () => {
    if (zoomed() || !sidebarOpen()) {
      return;
    }

    sizingAxis(sidebarPane).setOverride(null);
  };

  // A closed pane does not move: relocating something off-screen shows nothing and
  // Quietly rewrites a setting `ctrl-s` would persist.
  const movePane = () => {
    if (zoomed() || !sidebarOpen()) {
      return;
    }

    setSidebarPosition(NEXT_DOCK[sidebarPosition()]);
  };

  const overlayWidth = createMemo(() =>
    Math.max(30, Math.min(70, terminalWidth() - 8))
  );

  const overlayLeft = createMemo(() =>
    Math.max(0, Math.floor((terminalWidth() - overlayWidth()) / 2))
  );

  // --- status / cursor view-model ---
  const cursorLine = createMemo(() => navigableLines()[cursorIndex()]);
  const cursorLineContent = createMemo(() => cursorLine()?.content ?? "");

  const cursorLineNumber = createMemo(() => {
    const line = cursorLine();

    return line?.newLine ?? line?.oldLine;
  });

  // The word the caret sits on, for the highlight. Undefined in line-level mode or on a
  // Gap/word-less position.
  const caretWord = createMemo(() =>
    caretLineLevel() ? undefined : wordAt(cursorLineContent(), cursorColumn())
  );

  // The exact 1-based column the caret points at, for `:col` in copy. Driven
  // By line-level alone (not `caretWord`), so a search jump that lands in a gap
  // Still reports its precise column instead of falling back to line-only.
  const caretColumn = createMemo(() =>
    caretLineLevel() ? undefined : cursorColumn() + 1
  );

  // The inclusive [start, end] navIndex span of the active line selection, ordered
  // Regardless of drag direction; undefined when only a caret is present. Drives the
  // Selection band in the viewer and the range `C` copies.
  const selectionRange = createMemo(() => {
    const anchor = selectionAnchor();

    if (anchor === undefined) {
      return anchor;
    }

    const focus = cursorIndex();

    return [Math.min(anchor, focus), Math.max(anchor, focus)] as const;
  });

  // The selected lines' source text (no sign, no gutter), what `C` copies. Empty
  // When there is no selection; a folded or git-elided region is excluded for free,
  // Since it never enters `navigableLines`.
  const selectionText = createMemo(() => {
    const range = selectionRange();

    if (range === undefined) {
      return "";
    }

    return navigableLines()
      .slice(range[0], range[1] + 1)
      .map((line) => line.content)
      .join("\n");
  });

  // The context menu's inputs, gathered from the caret (viewer) or the focused node
  // (tree). Taking `context` as an argument (not the signal) lets `openCommandMenu`
  // Read a context's items before committing it, sidestepping the stale-memo read a
  // Same-batch signal write would cause.
  const commandMenuInput = (context: "tree" | "viewer"): CommandMenuInput => {
    if (context === "viewer") {
      return {
        caretColumn: caretColumn(),
        caretLine: cursorLineNumber(),
        context: "viewer",
        selectedPath: selectedPath(),
        treeNode: undefined,
        truncated: truncated(),
      };
    }

    const node = focusedTreeRow()?.node;

    return {
      caretColumn: undefined,
      caretLine: undefined,
      context: "tree",
      selectedPath: selectedPath(),
      treeNode:
        node === undefined
          ? undefined
          : { id: node.id, kind: node.type, path: node.path },
      truncated: false,
    };
  };

  // Both the render (CommandMenu) and the dispatch (keymap/click) read this one list,
  // So the highlighted index always maps to the same action. Gated on the menu being
  // Open so it does not rebuild on every caret move or tree refresh while closed.
  const commandMenuItems = createMemo(() =>
    commandMenuOpen()
      ? buildCommandMenuItems(commandMenuInput(commandMenuContext()))
      : []
  );

  // The bar's lowest tier: context-aware only for the temporary find modes, which have controls a
  // User cannot guess, and otherwise the one hint that reaches everything else. The panes get no
  // Standing tutorial line, since any live content outranks this and would bury it anyway.
  const guidance = createMemo(() => {
    if (findOpen()) {
      return ["enter find", "esc cancel"].join(BAR_SEP);
    }

    return (
      findActive() ? ["n/N next/prev", "esc clear"] : ["? help", "q quit"]
    ).join(BAR_SEP);
  });

  const statusBarModel = createMemo(() => {
    const latest = latestActivity(activityLog());

    const recent =
      latest !== undefined && now() - latest.at < RECENT_MS
        ? latest
        : undefined;

    return buildStatusBarModel({
      activity:
        recent === undefined
          ? undefined
          : {
              at: recent.at,
              changeKind: gitModel().changedByPath.get(recent.path)?.kind,
              path: recent.path,
            },
      alert: latestAlert(alerts()),
      foregroundProgress: switchProgress(),
      guidance: guidance(),
      notification: notice(),
      width: terminalWidth(),
    });
  });

  // --- navigation ---
  const canGoBack = createMemo(() => canBack(navState()));
  const canGoForward = createMemo(() => canForward(navState()));

  const captureCurrent = (): Location | undefined => {
    const path = selectedPath();

    if (path === undefined) {
      return undefined;
    }

    const context = {
      fileView: fileView(),
      fullContent: fullContentPaths().has(path),
      kind: currentLocation(navState())?.kind ?? "jump",
      path,
    };

    const pending = pendingRestore();

    // While a file loads, the live caret and scroll may still belong to the last file.
    if (pending?.path === path) {
      return { ...pending, ...context };
    }

    const line = navigableLines()[cursorIndex()];

    return {
      ...context,
      cursorColumn: cursorColumn(),
      cursorLine: line?.newLine ?? line?.oldLine,
      cursorSide:
        line?.newLine === undefined && line?.oldLine !== undefined
          ? "old"
          : undefined,
      viewport: { scrollTop: viewerScrollTop(), scrollX: viewerScrollX() },
    };
  };

  const arrivingLocation = (
    path: string,
    kind: "browse" | "jump",
    jump: JumpTarget | undefined
  ): Location => {
    const remembered = recall(navState(), path);
    const target = jump ?? remembered?.jump;

    return {
      cursorColumn: target === undefined ? remembered?.cursorColumn : undefined,
      cursorLine: target?.line ?? remembered?.cursorLine,
      cursorSide: target === undefined ? remembered?.cursorSide : undefined,
      fileView: false,
      fullContent: fullContentPaths().has(path),
      jump: target,
      kind,
      path,
      viewport: remembered?.viewport ?? { scrollTop: 0, scrollX: 0 },
    };
  };

  // Drive the live signals to a Location and enqueue its restore. The fullContent
  // Set is additive (a path stays un-truncated globally); back never re-truncates.
  // Any navigation reveals the file view. Keyed here rather than on a
  // SelectedPath *change*, so a jump landing on the already-selected file still
  // Closes the search view instead of being consumed invisibly behind it.
  const goToLocation = (location: Location) => {
    closeSearch();
    setSelectionAnchor(undefined);
    setSelectedPath(location.path);
    setFileView(location.fileView);

    if (location.fullContent) {
      setFullContentPaths((current) =>
        current.has(location.path)
          ? current
          : new Set(current).add(location.path)
      );
    }

    setPendingRestore({
      cursorColumn: location.cursorColumn,
      cursorLine: location.cursorLine,
      cursorSide: location.cursorSide,
      jump: location.jump,
      path: location.path,
      viewport: location.viewport,
    });
  };

  const navigateTo = (
    path: string,
    kind: "browse" | "jump",
    jump?: JumpTarget
  ) => {
    if (jump === undefined && selectedPath() === path) {
      // A deliberate open can make a browsed file a history stop without
      // reapplying its position or discarding the entries ahead of it.
      batch(() => {
        closeSearch();

        if (kind === "jump") {
          setSelectionAnchor(undefined);
          setNavState((nav) => {
            const current = currentLocation(nav);

            return current?.kind === "browse"
              ? recordCurrent(nav, { ...current, kind })
              : nav;
          });
        }
      });

      return;
    }

    const leaving = captureCurrent();

    // Reuse the live view for the same target line so an off-hunk jump does
    // not register a mode change before the viewer can resolve it.
    const arriving =
      jump !== undefined &&
      leaving?.path === path &&
      leaving.cursorLine === jump.line &&
      leaving.cursorSide === undefined
        ? { ...leaving, cursorColumn: undefined, jump, kind }
        : arrivingLocation(path, kind, jump);

    batch(() => {
      setNavState((nav) => navigate(recordLeaving(nav, leaving), arriving));
      goToLocation(arriving);
    });
  };

  const goBack = () => {
    const nav = navState();

    if (!canBack(nav)) {
      return;
    }

    const leaving = captureCurrent();
    const moved = back(recordLeaving(nav, leaving));
    const target = currentLocation(moved);
    batch(() => {
      setNavState(moved);

      if (target !== undefined) {
        goToLocation(target);
      }
    });
  };

  const goForward = () => {
    const nav = navState();

    if (!canForward(nav)) {
      return;
    }

    const leaving = captureCurrent();
    const moved = forward(recordLeaving(nav, leaving));
    const target = currentLocation(moved);
    batch(() => {
      setNavState(moved);

      if (target !== undefined) {
        goToLocation(target);
      }
    });
  };

  // Startup and worktree switches start a fresh history within the caller's batch.
  const seedNav = (path: string | undefined) => {
    if (path === undefined) {
      setNavState(initialNav(undefined));
      setSelectedPath(undefined);
      setFileView(false);
      setPendingRestore(undefined);

      return;
    }

    const location: Location = {
      cursorLine: undefined,
      fileView: false,
      fullContent: false,
      kind: "jump",
      path,
      viewport: { scrollTop: 0, scrollX: 0 },
    };

    setNavState(initialNav(location));
    goToLocation(location);
  };

  // --- actions ---
  const moveFocus = (direction: TreeMove) => {
    const model = treeTopology();
    model.move(direction);
    const node = model.focusedRow()?.node;

    if (node === undefined) {
      return;
    }

    if (node.type === "file") {
      navigateTo(node.path, "browse");
    }
  };

  const selectFile = (path: string, target?: JumpTarget) => {
    batch(() => {
      treeTopology().reveal(path);
      navigateTo(path, "jump", target);
    });
  };

  const toggleFileView = () => {
    const location = captureCurrent();

    if (location === undefined) {
      return;
    }

    const line = location.cursorLine;

    batch(() => {
      goToLocation({
        ...location,
        cursorColumn: undefined,
        cursorSide: undefined,
        fileView: !location.fileView,
        jump: line === undefined ? undefined : { escalate: false, line },
      });
    });
  };

  const activateTreeNode = () => {
    batch(() => {
      const path = treeTopology().activate();

      if (path !== null) {
        selectFile(path);
      }
    });
  };

  // Move the line cursor and land the caret on the new line's first word, so every
  // Vertical move (j/k, page, top/bottom, find cycle, the row click) leaves the
  // Caret on a word. A jump or restore sets the
  // Caret itself, so those use `setCursorIndex` directly and bypass this.
  const setCursorRow = (index: number) => {
    batch(() => {
      setCaretLineLevel(false);
      setSelectionAnchor(undefined);
      setCursorIndex(index);
      setCursorColumn(firstWord(navigableLines()[index]?.content ?? ""));
    });
  };

  // Extend (or begin) a line selection to `index`, keeping the caret on a symbol
  // There. Mirrors `setCursorRow` but seeds the anchor from the current row on the
  // First extend and, unlike it, preserves the anchor. Reached by Shift+arrow and a
  // Shift-click / drag in the viewer.
  const extendSelectionTo = (index: number) => {
    batch(() => {
      if (selectionAnchor() === undefined) {
        setSelectionAnchor(cursorIndex());
      }

      setCaretLineLevel(false);
      setCursorIndex(index);
      setCursorColumn(firstWord(navigableLines()[index]?.content ?? ""));
    });
  };

  // Hop the caret to the next word; past the line's last word it wraps to the next
  // Navigable line's first word, so h/l tab through every symbol in the file. From
  // Line-level (a gutter click), the first hop just selects the current first word.
  const caretNextWord = () => {
    setSelectionAnchor(undefined);

    if (caretLineLevel()) {
      setCaretLineLevel(false);

      return;
    }

    const content = cursorLineContent();
    const column = cursorColumn();
    const next = nextWord(content, column);

    if (next !== column) {
      setCursorColumn(next);

      return;
    }

    const lines = navigableLines();
    const index = cursorIndex();

    if (index < lines.length - 1) {
      batch(() => {
        setCursorIndex(index + 1);
        setCursorColumn(firstWord(lines[index + 1]?.content ?? ""));
      });
    }
  };

  // Hop the caret to the previous word; past the line's first word it wraps to the
  // Previous navigable line's last word. From line-level, select the line's last word.
  const caretPrevWord = () => {
    setSelectionAnchor(undefined);

    if (caretLineLevel()) {
      batch(() => {
        setCaretLineLevel(false);
        setCursorColumn(lastWord(cursorLineContent()));
      });

      return;
    }

    const content = cursorLineContent();
    const column = cursorColumn();
    const previous = prevWord(content, column);

    if (previous !== column) {
      setCursorColumn(previous);

      return;
    }

    const lines = navigableLines();
    const index = cursorIndex();

    if (index > 0) {
      batch(() => {
        setCursorIndex(index - 1);
        setCursorColumn(lastWord(lines[index - 1]?.content ?? ""));
      });
    }
  };

  // Toggle one fold, keeping the caret on its file line (or the fold header once the
  // Line it was on is hidden). The next navigable list is computed purely so the remap
  // Lands in the same batch as the set write, with no reliance on memo recomputation.
  const toggleFold = (key: string) => {
    const previous = navigableLines();
    const next = new Set(foldedRegions());

    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }

    const nextLines = collapsedNavigableFor(next, expandedGaps());
    // Remap the selection's anchor across the toggle exactly as the caret is, so a
    // Live selection survives a fold the same way the cursor does (setCursorRow
    // Clears the anchor, so restore the remapped value after it).
    const anchor = selectionAnchor();

    const remappedAnchor =
      anchor === undefined
        ? undefined
        : remapCursorAfterToggle(previous, anchor, nextLines);

    batch(() => {
      setFoldedRegions(next);
      setCursorRow(remapCursorAfterToggle(previous, cursorIndex(), nextLines));
      setSelectionAnchor(remappedAnchor);
    });
  };

  // Toggle one git-elided gap: reveal its unchanged lines (highlighted, from the
  // Diff's full contents) or collapse them again, keeping the caret on its file line.
  const toggleGap = (key: string) => {
    const previous = navigableLines();
    const next = new Set(expandedGaps());

    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }

    const nextLines = collapsedNavigableFor(foldedRegions(), next);
    const anchor = selectionAnchor();

    const remappedAnchor =
      anchor === undefined
        ? undefined
        : remapCursorAfterToggle(previous, anchor, nextLines);

    batch(() => {
      setExpandedGaps(next);
      setCursorRow(remapCursorAfterToggle(previous, cursorIndex(), nextLines));
      setSelectionAnchor(remappedAnchor);
    });
  };

  // The `z` action: fold/unfold the region at the caret. Unfold when the caret sits on
  // A folded header; otherwise fold the region it heads or is nested in; failing that,
  // Toggle the git-elided gap nearest the caret (hunk's "nearest to the selection").
  const toggleRegionAtCaret = () => {
    const lines = navigableLines();
    const index = cursorIndex();
    const caret = lines[index];

    if (caret === undefined) {
      return;
    }

    if (foldedRegions().has(foldKey(caret))) {
      toggleFold(foldKey(caret));

      return;
    }

    const regions = foldRegionsFor(lines, foldMode());

    const region =
      regions.find((candidate) => candidate.headerNavIndex === index) ??
      regions.find(
        (candidate) =>
          candidate.headerNavIndex < index && index <= candidate.endNavIndex
      );

    if (region !== undefined) {
      toggleFold(region.key);

      return;
    }

    const gap = nearestGapKey(index);

    if (gap !== undefined) {
      toggleGap(gap);
    }
  };

  const nearestGapKey = (cursorRow: number) => {
    const rows = viewerRows();

    const caretPos = rows.findIndex(
      (row) => row.kind === "line" && row.navIndex === cursorRow
    );

    const from = caretPos === -1 ? rows.length - 1 : caretPos;

    const gap =
      rows.slice(0, from + 1).findLast(isGapMarker) ??
      rows.slice(from + 1).find(isGapMarker);

    return gap?.kind === "marker" ? gap.key : undefined;
  };

  const revealFoldedLine = (line: number, side: DiffLineSide) => {
    const folded = foldedRegions();

    if (folded.size === 0) {
      return false;
    }

    const expanded = expandedLayout();

    if (expanded === undefined) {
      return false;
    }

    const rawIndex = expanded.navigable.findIndex(
      (navigable) => navigable[side] === line
    );

    if (rawIndex === -1) {
      return false;
    }

    const covering = foldRegionsFor(expanded.navigable, foldMode()).filter(
      (region) =>
        region.headerNavIndex < rawIndex &&
        rawIndex <= region.endNavIndex &&
        folded.has(region.key)
    );

    if (covering.length === 0) {
      return false;
    }

    const next = new Set(folded);

    for (const region of covering) {
      next.delete(region.key);
    }

    setFoldedRegions(next);

    return true;
  };

  // Hold a user-action acknowledgment for a fixed dwell (~1.5s) so an ambient
  // Status event or the next keystroke can't overwrite it before it's read.
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  // Left pending, it clears a notice 1.5s later, inside whichever test is running by then.
  onReset(() => {
    clearTimeout(noticeTimer);
  });

  const notify = (text: string, level: LogLevel = "info") => {
    setNotice({ level, text });
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      setNotice(undefined);
    }, 1500);
  };

  // Background, non-blocking: a newer release surfaces in the post-exit quit notice. Bounded by a
  // Timeout and error-swallowing in fetchLatestVersion, so it never blocks or breaks startup.
  const checkForUpdate = async (current: string) => {
    const epoch = resetEpoch;
    const latest = await fetchLatestVersion();

    if (epoch !== resetEpoch) {
      return;
    }

    if (latest !== undefined && isNewer(latest, current)) {
      setAvailableUpdate({ current, latest });
    }
  };

  // The active scope's identity, so a scope switch that leaves the path unchanged
  // Still drifts the anchor off the now-different diff. Includes headRef (the pinned
  // Sha for a commit scope), or two sibling commits sharing a first-parent would read
  // As the same scope and never drift the command menu (mirrors scopeKey).
  const scopeIdentity = () =>
    `${scope().kind}:${scope().ref}:${scope().headRef ?? ""}`;

  // Drop the line selection when the viewed content's identity changes (file,
  // Scope, or worktree): a navIndex anchor is meaningless against a different line
  // List. This is the structural backstop for every reload path (the scope menu,
  // A worktree switch, empty-worktree recovery) that does not route through the
  // Caret/`goToLocation` clears. It deliberately does not track the git model, so a
  // Background refresh of the same file keeps the selection instead of dropping it.
  createEffect(
    on(
      [selectedPath, scopeIdentity, repoRoot],
      () => {
        setSelectionAnchor(undefined);
      },
      {
        defer: true,
      }
    )
  );

  const copy = (text: string, message = `copied ${text.split("\n")[0]}`) => {
    const run = async () => {
      try {
        await runtime.runPromise(
          Clipboard.use((clipboard) => clipboard.copy(text))
        );
        notify(message, "success");
      } catch (error) {
        notify(
          `couldn't copy: ${error instanceof Error ? error.message : String(error)}`,
          "error"
        );
      }
    };

    void run();
  };

  // Reads the file fresh with `full: true` rather than reusing the loaded
  // `diffView`: in diff view only the diff is in memory, and the file-view
  // Snapshot can be truncated. Mirrors `loadDiffView`'s deleted-file gitSpec.
  const copyFileContents = () => {
    const path = selectedPath();

    if (path === undefined) {
      return;
    }

    const model = gitModel();
    const file = selectedFile();
    const currentScope = scope();

    const deletedSpec =
      currentScope.kind === "unstaged"
        ? `:${path}`
        : `${currentScope.ref}:${path}`;

    const gitSpec = file?.kind === "deleted" ? deletedSpec : undefined;

    const run = async () => {
      try {
        const content = await runtime.runPromise(
          File.use((service) =>
            service.content(model.repoRoot, path, { full: true, gitSpec })
          )
        );

        if (content.kind === "text") {
          copy(content.content, `copied ${path}`);

          return;
        }

        notify(`can't copy ${content.kind} file`, "warning");
      } catch (error) {
        notify(
          `couldn't copy: ${error instanceof Error ? error.message : String(error)}`,
          "error"
        );
      }
    };

    void run();
  };

  // Copy the selected lines' source text (no sign, no gutter), or the caret line
  // When there is no selection. Reads the on-screen `navigableLines`, so a folded or
  // Git-elided region is naturally excluded (it never enters that list). Reuses the
  // Shared `copy` sink for the pbcopy/wl-copy path and the success/error notice.
  const copySelection = () => {
    const range = selectionRange();

    if (range === undefined) {
      if (cursorLine() === undefined) {
        return;
      }

      copy(cursorLineContent(), "copied 1 line");

      return;
    }

    const count = range[1] - range[0] + 1;
    copy(selectionText(), `copied ${count} line${count === 1 ? "" : "s"}`);
  };

  // Opt the current path out of the truncation cap for a full re-read. Reached by
  // The `f` key and the truncation footer's click; the footer clearing and the
  // Content growing are the acknowledgment, so it stays silent.
  const loadFullContent = () => {
    const path = selectedPath();

    if (path === undefined) {
      return;
    }

    setFullContentPaths(new Set(fullContentPaths()).add(path));
  };

  const revealGapAtLine = (line: number, side: DiffLineSide) => {
    const gap = diffView()?.render.gapAtLine(line, side);
    const gaps = expandedGaps();

    if (gap === undefined || gaps.has(gap)) {
      return false;
    }

    setExpandedGaps(new Set(gaps).add(gap));

    return true;
  };

  // Keep the restore pending until the newly revealed or loaded rows arrive.
  const revealRestoreTarget = (pending: PendingRestore, full: boolean) => {
    const { jump } = pending;
    const line = jump?.line ?? pending.cursorLine;

    if (line === undefined) {
      return false;
    }

    const side = pending.cursorSide === "old" ? "oldLine" : "newLine";

    if (revealFoldedLine(line, side)) {
      return true;
    }

    if (jump === undefined && revealGapAtLine(line, side)) {
      return true;
    }

    if (truncated() && !full) {
      loadFullContent();

      return true;
    }

    if (
      jump !== undefined &&
      jump.escalate !== false &&
      selectedFile() !== undefined &&
      !fileView()
    ) {
      setFileView(true);

      return true;
    }

    return false;
  };

  // Open the context menu on a pane. A right-click passes its exact cell as `anchor`;
  // The keyboard trigger omits it, so the tree menu falls back to the focused row and
  // The viewer menu derives its anchor from the caret (stored as none). A no-op when
  // The context has no items (defensive: every real context has one).
  const openCommandMenu = (
    context: "tree" | "viewer",
    anchor?: { x: number; y: number }
  ) => {
    const items = buildCommandMenuItems(commandMenuInput(context));

    if (items.length === 0) {
      return;
    }

    batch(() => {
      setCommandMenuContext(context);
      // The tree menu falls back to the focused row's first text cell: the tree's interior, plus
      // The one column of padding a `TreeRow` adds inside it.
      setCommandMenuAnchor(
        context === "viewer"
          ? undefined
          : (anchor ?? {
              x: layout().sidebar.content.x + 1,
              y:
                layout().sidebar.content.y +
                focusedRowIndex() -
                sidebarScrollTop(),
            })
      );
      setCommandMenuIndex(0);
      // Snapshot the context so the clear effect can dismiss the menu the moment a
      // Click or refresh drifts the caret/focus/file it was opened against.
      setCommandMenuGuard({
        caretLineLevel: caretLineLevel(),
        context,
        cursorColumn: cursorColumn(),
        cursorIndex: cursorIndex(),
        focusedNodeId: focusedNodeId(),
        focusedPane: focusedPane(),
        path: selectedPath(),
        repoRoot: repoRoot(),
        scope: scopeIdentity(),
        scrollTop: viewerScrollTop(),
        scrollX: viewerScrollX(),
        sidebarScrollTop: sidebarScrollTop(),
      });
      setCommandMenuOpen(true);
    });
  };

  const closeCommandMenu = () => {
    batch(() => {
      setCommandMenuOpen(false);
      setCommandMenuGuard(undefined);
    });
  };

  // Dismiss the menu the instant its opening context drifts (a click elsewhere moves
  // The caret or focus, a scope/worktree change reloads the diff), so its open state
  // Can never outlive the anchored render and trap the keyboard.
  createEffect(() => {
    const guard = commandMenuGuard();

    if (guard === undefined) {
      return;
    }

    if (
      focusedPane() !== guard.focusedPane ||
      selectedPath() !== guard.path ||
      scopeIdentity() !== guard.scope ||
      repoRoot() !== guard.repoRoot ||
      (guard.context === "tree"
        ? focusedNodeId() !== guard.focusedNodeId ||
          sidebarScrollTop() !== guard.sidebarScrollTop
        : cursorIndex() !== guard.cursorIndex ||
          cursorColumn() !== guard.cursorColumn ||
          caretLineLevel() !== guard.caretLineLevel ||
          viewerScrollTop() !== guard.scrollTop ||
          viewerScrollX() !== guard.scrollX)
    ) {
      closeCommandMenu();
    }
  });

  // Open a file in the OS default application. A GUI handler that stet neither owns nor waits on
  // (fork-and-forget, no renderer suspend), so it lives in `state` and is reached directly by the
  // Keymap and the command menu, unlike the terminal editor which needs the renderer.
  const openExternally = (path: string) => {
    const argv = openExternalCommand(nodePath.join(gitModel().repoRoot, path));

    if (argv === undefined) {
      notify("open externally isn't supported on this platform", "warning");

      return;
    }

    runtime.runFork(
      Editor.use((editor) =>
        editor.openExternal(argv, gitModel().repoRoot)
      ).pipe(
        Effect.tap((code) =>
          code === 0
            ? Effect.void
            : Effect.sync(() => {
                notify("couldn't open the file", "warning");
              })
        ),
        Effect.catchTag("EditorError", (failure) =>
          Effect.sync(() => {
            notify(`couldn't open externally: ${failure.message}`, "error");
          })
        )
      )
    );
  };

  // Run a menu item's action by dispatching to the existing state action. `openEditor`
  // Is excluded: it needs the renderer, so the keymap (host) and the row click
  // (useRenderer) run it themselves; every other action is pure state.
  const dispatchCommandAction = (
    action: Exclude<CommandAction, { kind: "openEditor" }>
  ) => {
    switch (action.kind) {
      case "copyReference": {
        copy(
          formatCopyReference({
            column: action.column,
            line: action.line,
            path: action.path,
          })
        );
        break;
      }

      case "copyFileContents": {
        copyFileContents();
        break;
      }

      case "loadFullContent": {
        loadFullContent();
        break;
      }

      case "openExternal": {
        openExternally(action.path);
        break;
      }

      default: {
        action satisfies never;
      }
    }
  };

  // The only writer of `worktreeSummaries`. Reached from two places: the picker's
  // Open (so a single-worktree repo, which the background poll skips, still fills
  // Its row) and the peer poll below.
  const refreshWorktreeSummaries = async (
    list: readonly Worktree[],
    root: string
  ) => {
    const epoch = resetEpoch;

    try {
      const summaries = await runtime.runPromise(
        Git.use((git) => git.worktreeSummaries(list, root))
      );

      if (epoch !== resetEpoch) {
        return;
      }

      setWorktreeSummaries((previous) =>
        mergeWorktreeSummaries(previous, summaries)
      );
    } catch {
      // A failed summary pass keeps the previous ages; the next poll retries.
    }
  };

  const openWorktreePicker = () => {
    batch(() => {
      setWorktreeComboboxOpen(true);
      setWorktreeComboboxIndex(0);
      setWorktreeComboboxQuery("");
      setWorktrees(undefined);
    });
    loadWorktrees(gitModel().repoRoot);
  };

  const loadWorktrees = (root: string) => {
    const epoch = resetEpoch;
    // Opening the picker is the retry for a prior list failure, so retire that alert before the
    // Attempt: on success nothing re-raises and the stale error is gone, on failure the catch
    // Below raises it afresh. Only the list source: browsing the picker must not clear an
    // Unretried switch error, which is a separate lifecycle.
    clearAlert("worktree-list");

    const run = async () => {
      try {
        const list = await runtime.runPromise(
          Git.use((git) => git.worktrees(root))
        );

        // The picker's rows, its highlight, and the summaries refresh it kicks all happen after this
        // Await, so a reset that lands mid-list has to stop the lot: without this the refresh would
        // Merely start late, capture the *new* epoch, and be waved through by its own guard.
        if (epoch !== resetEpoch) {
          return;
        }

        const selectable = list.filter((worktree) => !worktree.bare);
        // Ordered once, here: the rows read their ages live from the summary map,
        // But the order is fixed at open, so a summary landing while the picker is
        // Up can never reshuffle the list under the cursor.
        const ordered = orderWorktrees(selectable, worktreeSummaries());
        batch(() => {
          setWorktrees(ordered);
          // Seed the highlight on the current worktree only when no query has been
          // Typed while loading was in flight; a query filters the list, so the
          // Full-list position could be out of range. The input resets to 0 on type.
          setWorktreeComboboxIndex(
            worktreeComboboxQuery() === ""
              ? Math.max(
                  0,
                  ordered.findIndex((worktree) => worktree.path === root)
                )
              : 0
          );
        });
        void refreshWorktreeSummaries(ordered, root);
      } catch (error) {
        if (epoch !== resetEpoch) {
          return;
        }

        batch(() => {
          setWorktreeComboboxOpen(false);
          raise(
            "worktree-list",
            "error",
            `couldn't list worktrees: ${error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error)}`
          );
        });
      }
    };

    void run();
  };

  // Open the theme picker on the row of the theme rendering now (so it reads as
  // "where am I now"), capturing the selection itself as the revert target. The
  // Row comes from the rendered name, not the selection: a `{dark,light}` pair
  // Or a former built-in name (`dark`) matches no row, and parking on `auto`
  // Would let the preview switch themes before a key is pressed.
  const openThemePicker = () => {
    const current = selection();
    const rendered = activeThemeName();

    const index =
      current === undefined
        ? 0
        : Math.max(
            0,
            themeComboboxItems().findIndex(
              (item) => item.selection === rendered
            )
          );

    batch(() => {
      setThemeComboboxOrigin(current);
      setThemeComboboxQuery("");
      setThemeComboboxIndex(index);
      setThemeComboboxOpen(true);
    });
  };

  // Commit applies the highlighted row's selection, cancel restores the one
  // Captured on open. Done explicitly (not left to the preview effect) so a click
  // Or enter finalizes deterministically even without a prior hover, then closing
  // Stops the effect from writing further.
  const closeThemePicker = (commit: boolean) => {
    if (commit) {
      const item = themeComboboxResults()[themeComboboxIndex()];
      setSelection(item === undefined ? themeComboboxOrigin() : item.selection);
    } else {
      setSelection(themeComboboxOrigin());
    }

    setThemeComboboxOpen(false);
  };

  /**
   * `ctrl-s`: write the current session settings back to the user config, as comment-preserving
   * edits touching only the keys that diverge from the file (`updateSettingsText` owns the diff and
   * the theme pair rule). The snapshot reads the live signals, so from inside the theme picker the
   * previewed selection is what saves; the keymap commits the picker first, so the session and the
   * file land on the same value.
   */
  const persistSettings = async () => {
    const snapshot = {
      appearance: appearance(),
      changesOnly: changesOnly(),
      editor: editorFlag(),
      iconsEnabled: iconsEnabled(),
      ide: ideFlag(),
      searchCaseSensitive: searchCaseSensitive(),
      searchRegex: searchRegex(),
      searchScope: searchScope(),
      sidebarHeight: sidebarHeightOverride() ?? undefined,
      sidebarOpen: sidebarOpen(),
      sidebarPosition: sidebarPosition(),
      sidebarWidth: sidebarWidthOverride() ?? undefined,
      theme: selection(),
      wrap: overflow() === "wrap",
    };

    try {
      const saved = await runtime.runPromise(
        Config.use((config) => config.persistSettings(snapshot))
      );

      notify(
        saved.length > 0
          ? `saved ${saved.join(", ")} to config`
          : "settings already saved",
        saved.length > 0 ? "success" : "info"
      );
    } catch (error) {
      notify(
        `couldn't save config: ${error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error)}`,
        "error"
      );
    }
  };

  // A monotonic token guards the async last-commit resolution: a newer pick (of
  // Any kind) bumps it, so a late parentRef result can't overwrite the newer scope.
  let scopeSelection = 0;
  // Bumped, never zeroed: these tokens are only compared for equality, so restoring 0 would let an
  // In-flight reply that captured 1 match the next 1 and be accepted as current. Incrementing is what
  // Invalidates the outstanding one.
  onReset(() => {
    scopeSelection += 1;
  });

  // Resolve a picked scope kind to a fully-formed DiffScope. last-commit needs its
  // Parent ref resolved (async), so it sets the scope once that lands, guarded
  // Against a newer pick and against an unborn HEAD (no commits yet, where a
  // `git diff <parent> HEAD` has no right side to diff). The others are synchronous.
  const selectScope = (kind: ScopeKind) => {
    scopeSelection += 1;
    const token = scopeSelection;

    if (kind === "session") {
      setScope({ kind, ref: sessionBase() });

      return;
    }

    if (kind === "last-commit") {
      const root = repoRoot();

      const resolve = async () => {
        try {
          const [head, parent] = await runtime.runPromise(
            Git.use((git) =>
              Effect.all([git.headRef(root), git.parentRef(root)])
            )
          );

          if (token !== scopeSelection) {
            return;
          }

          if (head === undefined) {
            notify("no commits yet");

            return;
          }

          setScope({ headRef: "HEAD", kind, ref: parent ?? emptyTree() });
        } catch {
          // An unreadable parent leaves the current scope in place.
        }
      };

      void resolve();

      return;
    }

    setScope({ kind, ref: baseRef() });
  };

  const LOG_LIMIT = 30;

  // The recent commits are a snapshot loaded when the drill-down opens, guarded so
  // A stale load (or one from a superseded open) can't overwrite a newer list.
  let commitsLoad = 0;
  onReset(() => {
    commitsLoad += 1;
  });

  const loadCommits = (root: string) => {
    commitsLoad += 1;
    const token = commitsLoad;
    // Clear the prior snapshot so nothing can select a stale row while the reload
    // Is in flight (the "loading" view hides the list, so this never flashes).
    setCommits([]);
    setCommitsStatus("loading");
    setCommitsNow(Math.floor(Date.now() / 1000));

    const load = async () => {
      try {
        const loaded = await runtime.runPromise(
          Git.use((git) => git.recentCommits(root, LOG_LIMIT))
        );

        if (token === commitsLoad) {
          setCommits(loaded);
          setCommitsStatus(loaded.length === 0 ? "empty" : "ready");
        }
      } catch {
        if (token === commitsLoad) {
          setCommits([]);
          setCommitsStatus("error");
        }
      }
    };

    void load();
  };

  // Pin the viewer to one commit shown as its own diff (its first parent..the
  // Commit), reusing the range-scope pipeline. Synchronous: the parent came with
  // The log, so no ref resolution is needed. Returns whether a commit was pinned
  // (false for an out-of-range index, e.g. an empty/loading list), so the caller
  // Only closes the picker on a real selection. Bumps the async-scope token so a
  // Pending last-commit resolution can't clobber the commit just pinned.
  const selectCommit = (index: number) => {
    const commit = commits()[index];

    if (commit === undefined) {
      return false;
    }

    scopeSelection += 1;
    setSelectedCommit(commit);
    setScope({
      headRef: commit.sha,
      kind: "commit",
      ref: commit.parent ?? emptyTree(),
    });

    return true;
  };

  // The header names the active commit by its subject alone (the sha lives in the
  // Picker); the "commit ·" scope marker at the diff already says it is a commit.
  // Read from the commit captured at selection, so the label holds even after the
  // Commit ages out of the reloaded list.
  const commitScopeLabel = createMemo(() => {
    const commit = selectedCommit();

    if (commit === undefined) {
      return "commit";
    }

    // Return the full subject; the header budgets it to the width it actually has.
    return commit.subject;
  });

  // A worktree switch is a new inspection context: the session base re-pins to the
  // New worktree's HEAD and session/last-commit (whose refs pointed into the old
  // Worktree's history) re-resolve against it. We return the resolved base and
  // Scope rather than committing them, so `switchWorktree` applies them only after
  // The model load succeeds and only for the latest request (a failed or superseded
  // Switch must not leave future session picks pointed at the wrong HEAD).
  // CLI-ref kinds (all/staged/unstaged) are valid in any worktree, so they carry over.
  const rebaselineScope = async (root: string) => {
    const head = await runtime.runPromise(Git.use((git) => git.headRef(root)));
    // Bornness belongs to the worktree, not the session: an orphan worktree has no HEAD to diff
    // Against even when the one being left did. Only the literal `HEAD` is substituted, since a ref
    // The user named resolves against the shared object database in either worktree.
    const unborn = cliBaseRef() === "HEAD" && head === undefined;
    const base = unborn ? emptyTree() : cliBaseRef();
    // The session base is a diff endpoint, so an unborn HEAD resolves to the empty tree here too.
    const headBase = head ?? emptyTree();
    const active = scope();

    if (active.kind === "session") {
      return {
        headUnborn: unborn,
        scope: { kind: "session", ref: headBase } satisfies DiffScope,
        sessionBase: headBase,
      };
    }

    // Both fall back to the default all-changes lens (the drill-down reloads against the new
    // History). For `commit` that is a change of inspection context, not a resolution failure:
    // Linked worktrees share one object database, so the pinned SHA still resolves in the target,
    // But it was picked out of the history the user just left. `last-commit` on an unborn HEAD is
    // The genuine one, having no right side to diff at all.
    if (active.kind === "commit" || (active.kind === "last-commit" && unborn)) {
      return {
        headUnborn: unborn,
        scope: { kind: "all", ref: base } satisfies DiffScope,
        sessionBase: headBase,
      };
    }

    if (active.kind === "last-commit") {
      const parent = await runtime.runPromise(
        Git.use((git) => git.parentRef(root))
      );

      return {
        headUnborn: unborn,
        scope: {
          headRef: "HEAD",
          kind: "last-commit",
          ref: parent ?? emptyTree(),
        } satisfies DiffScope,
        sessionBase: headBase,
      };
    }

    // `unstaged` ignores the ref entirely; `all`/`staged` re-point at the target worktree's base.
    return {
      headUnborn: unborn,
      scope: active.kind === "unstaged" ? active : { ...active, ref: base },
      sessionBase: headBase,
    };
  };

  // Repoint the whole app (tree, diffs, polling) at another worktree
  // Without a restart. Lives in state, not App, so the keymap, the picker's
  // Mouse click, and App's deleted-worktree recovery all reach the one action
  // Directly. It only writes state and reloads the model (no `renderer`), so it
  // Belongs here.
  //
  // `label` names the target in the progress line, and `successNotice` is for a switch the user
  // Did not ask for (the deleted-worktree recovery): an unrequested switch has to say so, where a
  // Requested one is already answered by the header it repointed.
  let switchRequest = 0;
  onReset(() => {
    switchRequest += 1;
  });

  const switchWorktree = async (
    worktree: Worktree,
    options?: {
      label?: string;
      successNotice?: { level: LogLevel; text: string };
    }
  ) => {
    setWorktreeComboboxOpen(false);
    // Stamp and clear at the very top, before the validations, so every call supersedes: a load is
    // Async, and a second switch started before the first resolves could otherwise land out of
    // Order and overwrite the newer worktree. The stamp and the progress clear must lead the
    // Same-path and missing-path early returns too, or an invalid selection would leave an older
    // In-flight request as the latest one, and its stale completion could still commit or report.
    switchRequest += 1;
    const request = switchRequest;
    setSwitchProgress(undefined);

    if (worktree.path === gitModel().repoRoot) {
      return;
    }

    const label = options?.label ?? worktreeLabel(worktree);

    if (!existsSync(worktree.path)) {
      raise("worktree-switch", "warning", `missing worktree: ${worktree.path}`);

      return;
    }

    // This attempt owns the switch alert from here: a retry clears the failure it is retrying
    // Before it can contradict the progress line.
    batch(() => {
      clearAlert("worktree-switch");
      setSwitchProgress(`switching to ${label}…`);
    });

    try {
      // Re-pin session/last-commit to the target worktree's history before loading.
      const {
        headUnborn: nextHeadUnborn,
        sessionBase: nextSessionBase,
        scope: nextScope,
      } = await rebaselineScope(worktree.path);

      // Load only the changed set (the same shape startup seeds, repoFiles empty),
      // So the tree repoints the instant the cheap diff commands resolve instead of
      // Blocking on `git ls-files --stage` over the whole worktree. The repoFilesPoll
      // In the refresh effect re-keys on the new repoRoot and fills the full tree.
      const changed = await runtime.runPromise(
        Git.use((git) => git.changedFiles(worktree.path, nextScope))
      );

      if (request !== switchRequest) {
        return;
      }

      const fresh: GitModel = {
        repoRoot: worktree.path,
        ...changed,
        repoFiles: [],
        repoFilesKey: "",
      };

      const selected = fresh.changed[0]?.path ?? fresh.repoFiles[0]?.path;

      const expanded = defaultExpandedDirectories(
        fresh.changed.map((file) => file.path)
      );

      batch(() => {
        setHeadUnborn(nextHeadUnborn);
        setSessionBase(nextSessionBase);
        setScope(nextScope);
        setCurrentWorktreeDeleted(false);
        setLastChange(Date.now());
        setRepoRoot(fresh.repoRoot);
        setGitModel(fresh);
        focusTreeNode(selected === undefined ? "" : `file:${selected}`);
        setExpandedDirectories(
          selected === undefined
            ? expanded
            : expandAncestorsForPath(expanded, selected)
        );
        setFullContentPaths(new Set<string>());
        seedNav(selected);
        setActivityLog(emptyActivityLog);
        // The new worktree starts at the tree, but only when the tree is on screen. This has to
        // Stay after `seedNav`, which can route through `closeSearch`: reads inside a batch see
        // Earlier writes, so `viewerFocus` needs the settled `mainView`, and `seedNav(undefined)`
        // Returns early without closing the search view, so both branches depend on the order.
        setFocusedPane(sidebarOpen() ? "tree" : viewerFocus());
        // The header now names the worktree we landed in, so a success line here would only
        // Repeat it, and would still be sitting there long after it stopped being news.
        setSwitchProgress(undefined);

        if (options?.successNotice !== undefined) {
          notify(options.successNotice.text, options.successNotice.level);
        }
      });
    } catch (error) {
      if (request !== switchRequest) {
        return;
      }

      batch(() => {
        setSwitchProgress(undefined);
        raise(
          "worktree-switch",
          "error",
          `couldn't switch worktree: ${error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error)}`
        );
      });
    }
  };

  // --- background fibers (re-key/restart reactively, interrupt the prior fiber
  // On cleanup so an in-flight git is killed) ---

  // Event-driven git refresh. A debounced fs-watch tick re-derives the changed
  // Set the instant a real change lands; a slow safety poll is the floor that
  // Covers anything the watcher misses (a platform without recursive watch, a
  // Gitignored boundary), so the worst case is poll-speed, never stale. The repo
  // File list refreshes only when the changed set's paths shift (plus a slow
  // Floor), never on a blind timer. Re-keys only on repoRoot/scope; cleanup
  // Aborts the controller, closing the watcher and any in-flight git.
  createEffect(() => {
    const root = repoRoot();
    const scopeNow = scope();

    if (root === "") {
      return;
    }

    const controller = new AbortController();
    // A fresh worktree re-proves the watcher from scratch (its fs.watch is new).
    setLastWatcherTick(0);

    const run = async () => {
      try {
        await runtime.runPromise(
          Effect.gen(function* refreshLoop() {
            // Two conflating queues (sliding, capacity 1): every trigger collapses
            // To at most one pending run, so a burst of fs events on a large repo
            // Can never queue a backlog of expensive `git status` / `ls-files`
            // Reads. Each drain is serial, so two reads of the same kind never
            // Overlap and write each other's stale result.
            const changedTriggers = yield* Queue.sliding<undefined>(1);
            const repoFilesTriggers = yield* Queue.sliding<undefined>(1);

            // Whether `HEAD` is still a diff endpoint, repaired in **both** directions off the drain:
            // A repository's first commit gives `HEAD` a meaning and returns the base to it, while a
            // `git checkout --orphan` takes it away again. Neither is observable from the other side,
            // And a one-directional repair left the second case failing silently on every tick with
            // The tree frozen and no alert. Only the literal `HEAD` is ever substituted, so a ref the
            // User named keeps its own meaning on an orphan branch.
            const repairBase = Git.use((git) => git.headRef(root)).pipe(
              Effect.tap((head) =>
                Effect.sync(() => {
                  const unborn = cliBaseRef() === "HEAD" && head === undefined;

                  if (repoRoot() !== root || unborn === headUnborn()) {
                    return;
                  }

                  batch(() => {
                    setHeadUnborn(unborn);
                    const current = scope();
                    const base = unborn ? emptyTree() : cliBaseRef();

                    // `last-commit`'s right side is the literal HEAD, so an unborn one leaves it with
                    // No side to diff; it falls back to the default lens exactly as a worktree switch
                    // Into an orphan checkout does. `session` and `commit` hold resolved SHAs, which
                    // Survive the checkout, so they are left alone.
                    if (unborn && current.kind === "last-commit") {
                      setScope({ kind: "all", ref: base });

                      return;
                    }

                    if (
                      (current.kind === "all" || current.kind === "staged") &&
                      current.ref !== base
                    ) {
                      setScope({ ...current, ref: base });
                    }
                  });
                })
              ),
              Effect.ignore
            );

            const refreshChanged = Git.use((git) =>
              git.changedFiles(root, scopeNow)
            ).pipe(
              // Functional update so the merge is always against the latest committed
              // Model: the repoFiles drain runs concurrently, so reasoning about which
              // Write lands first is unnecessary when each merges from the current state.
              Effect.tap((next) =>
                Effect.sync(() =>
                  setGitModel((prev) => {
                    if (prev.repoRoot !== root) {
                      return prev;
                    }

                    // Only re-list the whole repo when the file set actually shifted;
                    // A content-only edit leaves the tree structure untouched.
                    if (changedPathsDiffer(prev.changed, next.changed)) {
                      Queue.offerUnsafe(repoFilesTriggers, undefined);
                    }

                    return mergeChanged(prev, next);
                  })
                )
              ),
              // Last-commit's right side is the literal HEAD (it always follows the
              // Newest commit), but its parent must re-resolve as HEAD moves so a new
              // Commit advances the window and re-keys checks. Guarded so we only re-key
              // When the parent actually changed; session/all/staged need no resolution.
              Effect.tap(() =>
                scopeNow.kind === "last-commit"
                  ? Git.use((git) => git.parentRef(root)).pipe(
                      Effect.tap((parent) =>
                        Effect.sync(() => {
                          const current = scope();
                          // Compare against the substituted ref, not the raw parent: on a root commit
                          // The parent is `undefined` while the scope holds the empty tree, so testing
                          // The raw value would differ on every tick and re-set the scope forever,
                          // Resetting the viewer's cursor and scroll each time.
                          const ref = parent ?? emptyTree();

                          if (
                            current.kind === "last-commit" &&
                            current.ref !== ref
                          ) {
                            setScope({
                              headRef: "HEAD",
                              kind: "last-commit",
                              ref,
                            });
                          }
                        })
                      ),
                      Effect.ignore
                    )
                  : Effect.void
              ),
              // A successful read only ever proves HEAD is still what it was, so the born direction is
              // Checked while the base is substituted and a repository with commits pays nothing.
              Effect.tap(() => (headUnborn() ? repairBase : Effect.void)),
              // The heartbeat is the always-on detector: a failure means this worktree
              // Was deleted when its root is gone, or when the main worktree is gone (a
              // Linked worktree's git breaks once main's .git is deleted, even if its own
              // Dir lingers). Flag it (App recovers); any other failure is transient.
              Effect.catch(() =>
                Effect.sync(() => {
                  const main = mainWorktreePath();

                  if (
                    repoRoot() === root &&
                    (!existsSync(root) || (main !== "" && !existsSync(main)))
                  ) {
                    setCurrentWorktreeDeleted(true);
                  }
                }).pipe(
                  // A read that fails on a live worktree is the other direction: `git diff HEAD`
                  // Stops working the moment HEAD becomes unborn, and no success path can see it.
                  Effect.flatMap(() => repairBase)
                )
              )
            );

            const refreshRepoFiles = Git.use((git) => git.repoFiles(root)).pipe(
              Effect.tap((next) =>
                Effect.sync(() =>
                  setGitModel((prev) =>
                    prev.repoRoot === root &&
                    prev.repoFilesKey !== next.repoFilesKey
                      ? {
                          ...prev,
                          repoFiles: next.repoFiles,
                          repoFilesKey: next.repoFilesKey,
                        }
                      : prev
                  )
                )
              ),
              Effect.ignore
            );

            // Changed-set triggers: an immediate tick on (re)key, a debounced
            // Fs-watch tick per change (which also records watcher health), and a
            // Safety poll whose cadence adapts to that health — fast where the
            // Watcher is unproven or has missed a change, slow once it has earned
            // Trust. See `refreshDelay`.
            const watchTicks = Stream.unwrap(
              Effect.gen(function* watchStream() {
                const watcher = yield* Watcher;

                return watcher.changes(root);
              })
            ).pipe(
              Stream.tap(() =>
                Effect.sync(() => setLastWatcherTick(Date.now()))
              )
            );

            const safetyTicks = Stream.fromEffect(
              Effect.suspend(() =>
                Effect.sleep(
                  refreshDelay({
                    lastChangeAt: lastChange(),
                    lastWatcherTickAt: lastWatcherTick(),
                    now: Date.now(),
                  })
                )
              )
            ).pipe(Stream.forever);

            // RepoFiles triggers: an immediate load on (re)key plus a slow floor.
            // The changed refresh wakes it on any real structural shift, so this
            // Floor only covers a change the changed set never reflected.
            const repoFilesFloor = Stream.fromEffect(
              Effect.sleep("30 seconds")
            ).pipe(Stream.forever);

            const feedChanged = Stream.mergeAll(
              [Stream.make(undefined), watchTicks, safetyTicks],
              {
                concurrency: "unbounded",
              }
            ).pipe(
              Stream.runForEach(() => Queue.offer(changedTriggers, undefined))
            );

            const feedRepoFiles = Stream.mergeAll(
              [Stream.make(undefined), repoFilesFloor],
              {
                concurrency: "unbounded",
              }
            ).pipe(
              Stream.runForEach(() => Queue.offer(repoFilesTriggers, undefined))
            );

            const drainChanged = Stream.fromQueue(changedTriggers).pipe(
              Stream.mapEffect(() => refreshChanged),
              Stream.runDrain
            );

            const drainRepoFiles = Stream.fromQueue(repoFilesTriggers).pipe(
              Stream.mapEffect(() => refreshRepoFiles),
              Stream.runDrain
            );

            // All four run until the controller aborts (worktree/scope re-key),
            // Which interrupts the fiber and closes the watcher's fs handles.
            yield* Effect.all(
              [feedChanged, feedRepoFiles, drainChanged, drainRepoFiles],
              {
                concurrency: "unbounded",
              }
            );
          }),
          { signal: controller.signal }
        );
      } catch {
        // Aborting the controller on a re-key interrupts the loop; nothing to report.
      }
    };

    void run();
    onCleanup(() => {
      controller.abort();
    });
  });

  // Keep every worktree's summary warm, so the header can say that an agent is working
  // Somewhere else and the picker opens on real ages instead of a loading row. Polled
  // Rather than watched: only the active worktree earns an fs watcher, and the ages this
  // Feeds are real timestamps (a file mtime, a reflog mtime, a commit date), so a poll that
  // Runs late still reports an exact age; only its appearance lags, by at most one tick.
  //
  // `git worktree list` is also the discovery mechanism, so it cannot be resolved once at
  // Startup: an agent can create a worktree mid-session. It is a cheap directory read, and a
  // Repo with a single worktree stops there, never paying for a `git status` it has no peer
  // To compare against.
  createEffect(() => {
    const root = repoRoot();

    if (root === "") {
      return;
    }

    const controller = new AbortController();

    const run = async () => {
      try {
        await runtime.runPromise(
          Effect.gen(function* peerSummaryLoop() {
            const git = yield* Git;

            while (true) {
              const list = yield* git
                .worktrees(root)
                .pipe(Effect.orElseSucceed(() => []));

              const selectable = list.filter((worktree) => !worktree.bare);

              if (selectable.length > 1) {
                yield* Effect.promise(async () => {
                  await refreshWorktreeSummaries(selectable, root);
                });
              }

              yield* Effect.sleep(PEER_SUMMARY_MS);
            }
          }),
          { signal: controller.signal }
        );
      } catch {
        // Aborting the controller on a re-key interrupts the poll; nothing to report.
      }
    };

    void run();
    onCleanup(() => {
      controller.abort();
    });
  });

  // Tick the recency clock once a second while anything is still fading, then stop. Drives the
  // Tree's fading recency dots, the status bar's fading activity path, and every age in the worktree
  // Picker (all read now()). The two sources decay over different windows, so each keeps the clock
  // Awake for its own: a changed file for RECENT_MS, a worktree being worked in for the much longer
  // WORKTREE_ACTIVE_MS.
  //
  // `worktreeAt` spans **every** worktree, including the one being inspected: the picker fades an
  // Age for the worktree you are *in* too, so excluding it would freeze that row 30s after its last
  // Edit (once the file log ages out of RECENT_MS), leaving it reading `now` in fresh pink minutes
  // After the agent stopped.
  createEffect(() => {
    const fileAt = latestActivity(activityLog())?.at ?? 0;

    const worktreeAt = Math.max(
      0,
      ...[...worktreeSummaries().values()].map(
        (summary) => summary.lastActivityAt ?? 0
      )
    );

    const fading = () =>
      Date.now() - fileAt < RECENT_MS ||
      Date.now() - worktreeAt < WORKTREE_ACTIVE_MS;

    if ((fileAt === 0 && worktreeAt === 0) || !fading()) {
      setNow(Date.now());

      return;
    }

    const timer = setInterval(() => {
      setNow(Date.now());

      if (!fading()) {
        clearInterval(timer);
      }
    }, 1000);

    onCleanup(() => {
      clearInterval(timer);
    });
  });

  // Detect agent edits from each new model and record them as activity. A scope or
  // RepoRoot change (a scope pick, a worktree switch, or the initial seed) only
  // Re-baselines, so a swapped changed-set is never mistaken for agent edits.
  let previousChanged: ChangedFile[] = [];
  let previousScopeKey = "";
  let previousRepoRoot = "";
  onReset(() => {
    previousChanged = [];
    previousScopeKey = "";
    previousRepoRoot = "";
  });
  createEffect(() => {
    const model = gitModel();

    const previousByPath = new Map(
      previousChanged.map((file) => [file.path, file])
    );

    const prevScopeKey = previousScopeKey;
    const prevRepoRoot = previousRepoRoot;
    previousChanged = model.changed;
    previousScopeKey = model.scopeKey;
    previousRepoRoot = model.repoRoot;

    if (model.repoRoot !== prevRepoRoot) {
      return;
    }

    if (prevScopeKey !== model.scopeKey) {
      return;
    }

    const entries: { path: string; kind: ActivityEventKind }[] = [];

    for (const file of model.changed) {
      const before = previousByPath.get(file.path);

      if (before === undefined) {
        entries.push({ kind: "appeared", path: file.path });
      } else if (
        before.additions !== file.additions ||
        before.deletions !== file.deletions
      ) {
        entries.push({ kind: "changed", path: file.path });
      }

      previousByPath.delete(file.path);
    }

    for (const path of previousByPath.keys()) {
      entries.push({ kind: "removed", path });
    }

    if (entries.length > 0) {
      batch(() => {
        setLastChange(Date.now());
        setActivityLog((current) =>
          recordActivity(current, entries, Date.now())
        );
      });
    }
  });

  return {
    activateTreeNode,
    activityLog,
    availableUpdate,
    canGoBack,
    canGoForward,
    caretColumn,
    caretLineLevel,
    caretNextWord,
    caretPrevWord,
    caretWord,
    changesOnly,
    checkForUpdate,
    closeCommandMenu,
    closeSearch,
    closeThemePicker,
    collapseSidebar,
    commandMenuAnchor,
    commandMenuContext,
    commandMenuIndex,
    commandMenuItems,
    commandMenuOpen,
    commitScopeLabel,
    commits,
    commitsNow,
    commitsStatus,
    copy,
    copyFileContents,
    copySelection,
    currentWorktreeDeleted,
    cursorColumn,
    cursorIndex,
    cursorLineContent,
    cursorLineNumber,
    diffView,
    directoryRecencyByPath,
    dispatchCommandAction,
    editorTemplate,
    emptyTree,
    extendSelectionTo,
    fileComboboxIndex,
    fileComboboxOpen,
    fileComboboxQuery,
    fileComboboxResults,
    fileView,
    findActive,
    findMatchPos,
    findMatches,
    findOpen,
    findQuery,
    focusNextPane,
    focusTreeNode,
    focusedNodeId,
    focusedPane,
    focusedRowIndex,
    focusedTreeRow,
    fullContentPaths,
    gitModel,
    goBack,
    goForward,
    growPane,
    helpDialogOpen,
    helpView,
    iconsEnabled,
    ideTemplate,
    jumpToSearchItem,
    layout,
    loadCommits,
    loadFullContent,
    mainView,
    mainWorktreePath,
    moveFocus,
    movePane,
    moveSearchSelection,
    navState,
    navigableLines,
    notify,
    now,
    openCommandMenu,
    openExternally,
    openFileCombobox,
    openSearch,
    openThemePicker,
    openWorktreePicker,
    overflow,
    overlayLeft,
    overlayWidth,
    pageSearchSelection,
    pendingRestore,
    persistSettings,
    quitConfirmOpen,
    recencyByPath,
    repoFilesLoading,
    repoRoot,
    resetFind,
    resetPane,
    resetState,
    revealRestoreTarget,
    scope,
    scopeMenuIndex,
    scopeMenuOpen,
    scopeMenuView,
    searchCaseSensitive,
    searchFocus,
    searchGlob,
    searchIndex,
    searchItems,
    searchListHeight,
    searchQuery,
    searchRegex,
    searchResults,
    searchScope,
    searchScrollTop,
    searchStatus,
    searchTruncated,
    seedNav,
    selectCommit,
    selectFile,
    selectScope,
    selectedFile,
    selectedPath,
    selectionAnchor,
    selectionRange,
    selectionText,
    setActivityLog,
    setCaretLineLevel,
    setChangesOnly,
    setCliBaseRef,
    setCommandMenuIndex,
    setCommits,
    setCurrentWorktreeDeleted,
    setCursorColumn,
    setCursorIndex,
    setCursorRow,
    setEditorFlag,
    setEditorTemplate,
    setEmptyTree,
    setExpandedDirectories,
    setFileComboboxIndex,
    setFileComboboxOpen,
    setFileComboboxQuery,
    setFileView,
    setFindActive,
    setFindMatchPos,
    setFindOpen,
    setFindQuery,
    setFocusedPane,
    setFullContentPaths,
    setGitModel,
    setHeadUnborn,
    setHelpDialogOpen,
    setHelpView,
    setIconsEnabled,
    setIdeFlag,
    setIdeTemplate,
    setLastChange,
    setMainWorktreePath,
    setNotice,
    setNow,
    setOverflow,
    setPendingRestore,
    setQuitConfirmOpen,
    setRepoRoot,
    setScope,
    setScopeMenuIndex,
    setScopeMenuOpen,
    setScopeMenuView,
    setSearchCaseSensitive,
    setSearchFocus,
    setSearchGlob,
    setSearchIndex,
    setSearchQuery,
    setSearchRegex,
    setSearchScope,
    setSearchScrollTop,
    setSearchSelection,
    setSelectionAnchor,
    setSessionBase,
    setSidebarHeightOverride,
    setSidebarOpen,
    setSidebarPosition,
    setSidebarScrollTop,
    setSidebarWidthOverride,
    setTerminalHeight,
    setTerminalSuspended,
    setTerminalWidth,
    setThemeComboboxIndex,
    setThemeComboboxQuery,
    setViewerScrollTop,
    setViewerScrollX,
    setWorktreeComboboxIndex,
    setWorktreeComboboxOpen,
    setWorktreeComboboxQuery,
    setWorktreeSummaries,
    setWorktrees,
    showFileContent,
    shrinkPane,
    sidebarOpen,
    sidebarPosition,
    sidebarScrollTop,
    statusBarModel,
    switchWorktree,
    terminalHeight,
    terminalSuspended,
    terminalWidth,
    themeComboboxIndex,
    themeComboboxOpen,
    themeComboboxOrigin,
    themeComboboxResults,
    toggleFileView,
    toggleFold,
    toggleGap,
    toggleRegionAtCaret,
    toggleSearchCase,
    toggleSearchGroup,
    toggleSearchRegex,
    toggleSearchScope,
    toggleSidebar,
    toggleTreeNode,
    toggleZoom,
    treeRowCount,
    treeSlice,
    truncated,
    truncatedHidden,
    viewerFocus,
    viewerHeight,
    viewerRows,
    viewerScrollTop,
    viewerScrollX,
    worktreeComboboxIndex,
    worktreeComboboxOpen,
    worktreeComboboxQuery,
    worktreeComboboxResults,
    worktreeSummaries,
    worktrees,
    zoomed,
  };
};

// One global reactive root owns every signal/memo/effect for the app's lifetime
// (the process exits rather than disposing it), so module consumers can import
// Accessors directly without prop-drilling or a context provider.
export const state = createRoot(createState);
