import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";

import {
  outOfTreeBases,
  parseWatcherRegistrations,
  parseWatcherUnregistrations,
  watchedFileChanges,
  watchedKindMask,
} from "@/diagnostics/watched-files";

const REPO = join(sep, "repo");

// The exact payload basedpyright sends once the client advertises `dynamicRegistration`: a config
// Watcher plus a catch-all, then one `RelativePattern` per Python search path.
const pyrightRegistration = (searchPaths: string[] = []) => ({
  registrations: [
    {
      id: "pyright-watch",
      method: "workspace/didChangeWatchedFiles",
      registerOptions: {
        watchers: [
          { globPattern: "**/pyrightconfig.json", kind: 7 },
          { globPattern: "**", kind: 7 },
          ...searchPaths.map((path) => ({
            globPattern: { baseUri: pathToFileURL(path).href, pattern: "**" },
            kind: 7,
          })),
        ],
      },
    },
  ],
});

/** Whether any registered watcher claimed this path, which is decided before anything stats it. */
const claims = (registrations: ReturnType<typeof parseWatcherRegistrations>, path: string) =>
  watchedKindMask(registrations, path) !== 0;

const NOT_TRACKED = () => false;
const TRACKED = () => true;

test("pyright's catch-all glob claims a package installed into an in-repo venv", () => {
  const registrations = parseWatcherRegistrations(pyrightRegistration(), REPO);

  expect(
    claims(
      registrations,
      join(REPO, ".venv", "lib", "python3.14", "site-packages", "fastapi", "__init__.py"),
    ),
  ).toBe(true);
  expect(claims(registrations, join(REPO, "pyrightconfig.json"))).toBe(true);
  expect(claims(registrations, join(REPO, "src", "main.py"))).toBe(true);
});

test("a path outside the worktree is not claimed by a worktree-relative glob", () => {
  const registrations = parseWatcherRegistrations(pyrightRegistration(), REPO);

  expect(claims(registrations, join(sep, "elsewhere", "main.py"))).toBe(false);
});

test("a RelativePattern claims only paths under its own base", () => {
  const venv = join(sep, "home", "me", ".virtualenvs", "app", "lib", "site-packages");
  const registrations = parseWatcherRegistrations(pyrightRegistration([venv]), REPO);

  expect(claims(registrations, join(venv, "fastapi", "__init__.py"))).toBe(true);
  expect(claims(registrations, join(sep, "home", "me", "unrelated.py"))).toBe(false);
});

test("out-of-tree bases are the ones the worktree watcher cannot see", () => {
  const venv = join(sep, "home", "me", ".virtualenvs", "app");
  const inRepo = join(REPO, ".venv");
  const registrations = parseWatcherRegistrations(pyrightRegistration([venv, inRepo]), REPO);

  // The in-repo base rides the worktree watcher already; only the external one needs its own watch.
  expect(outOfTreeBases(registrations, REPO)).toEqual([venv]);
});

test("out-of-tree bases are sorted, not registration-ordered", () => {
  const pyenv = join(sep, "opt", "pyenv", "versions", "3.14", "lib", "site-packages");
  const conda = join(sep, "home", "me", "conda", "envs", "app");
  const registrations = parseWatcherRegistrations(pyrightRegistration([pyenv, conda]), REPO);

  // A function of the base set: a re-registration naming the same paths in another order must
  // Compare equal upstream instead of tearing the watchers down and rebuilding them.
  expect(outOfTreeBases(registrations, REPO)).toEqual([conda, pyenv]);
});

test("registrations for other methods are ignored", () => {
  const registrations = parseWatcherRegistrations(
    {
      registrations: [
        { id: "fmt", method: "textDocument/formatting", registerOptions: {} },
        {
          id: "watch",
          method: "workspace/didChangeWatchedFiles",
          registerOptions: { watchers: [{ globPattern: "**/Cargo.toml" }] },
        },
      ],
    },
    REPO,
  );

  expect(registrations.map((registration) => registration.id)).toEqual(["watch"]);
  expect(claims(registrations, join(REPO, "Cargo.toml"))).toBe(true);
});

test("a server that registers nothing claims nothing", () => {
  expect(claims([], join(REPO, "src", "main.py"))).toBe(false);
  expect(parseWatcherRegistrations({ registrations: [] }, REPO)).toEqual([]);
  expect(parseWatcherRegistrations(undefined, REPO)).toEqual([]);
});

test("a registration whose globs all fail to compile is dropped", () => {
  // A non-file scheme has no path to watch, so the watcher (and its registration) carries nothing.
  const registrations = parseWatcherRegistrations(
    {
      registrations: [
        {
          id: "untitled",
          method: "workspace/didChangeWatchedFiles",
          registerOptions: {
            watchers: [{ globPattern: { baseUri: "untitled:doc", pattern: "**" } }],
          },
        },
      ],
    },
    REPO,
  );

  expect(registrations).toEqual([]);
});

test("unregistration drops only file-watching ids", () => {
  expect(
    parseWatcherUnregistrations({
      unregisterations: [
        { id: "watch", method: "workspace/didChangeWatchedFiles" },
        { id: "fmt", method: "textDocument/formatting" },
      ],
    }),
  ).toEqual(["watch"]);
});

test("an absolute glob outside the worktree is watched, not just matched", () => {
  const stdlib = join(sep, "opt", "python", "lib", "python3.14");
  const registrations = parseWatcherRegistrations(
    {
      registrations: [
        {
          id: "stdlib",
          method: "workspace/didChangeWatchedFiles",
          registerOptions: { watchers: [{ globPattern: join(stdlib, "**", "*.py") }] },
        },
      ],
    },
    REPO,
  );

  // Re-rooted at its literal prefix, so it surfaces as a base the pool can actually put a watch on.
  // Left as a bare pattern it would match events nothing was ever going to deliver.
  expect(outOfTreeBases(registrations, REPO)).toEqual([stdlib]);
  expect(claims(registrations, join(stdlib, "json", "tool.py"))).toBe(true);
  expect(claims(registrations, join(REPO, "main.py"))).toBe(false);
});

test("an absolute pattern naming one exact file is rooted at its directory", () => {
  // No wildcard at all, so the literal prefix is every component but the filename. A server pinning
  // A single config outside the repo still has to yield a directory, since a file is not watchable
  // As a base.
  const config = join(sep, "etc", "pyrightconfig.json");
  const registrations = parseWatcherRegistrations(
    {
      registrations: [
        {
          id: "config",
          method: "workspace/didChangeWatchedFiles",
          registerOptions: { watchers: [{ globPattern: config }] },
        },
      ],
    },
    REPO,
  );

  expect(outOfTreeBases(registrations, REPO)).toEqual([join(sep, "etc")]);
  expect(claims(registrations, config)).toBe(true);
  // Its sibling in the same watched directory is not what the server asked for.
  expect(claims(registrations, join(sep, "etc", "hosts"))).toBe(false);
});

// Typing a change reads the disk (`fs.watch` calls both an appearance and a vanishing a "rename", so
// Only presence separates them), so from here the tests drive a real worktree, not synthetic paths.
const withRepo = (run: (repo: string) => void) => {
  const repo = mkdtempSync(join(tmpdir(), "watched-files-"));
  try {
    run(repo);
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
};

test("a package installed into the venv is forwarded as Created", () => {
  withRepo((repo) => {
    const registrations = parseWatcherRegistrations(pyrightRegistration(), repo);
    const path = join(".venv", "lib", "site-packages", "fastapi", "__init__.py");
    mkdirSync(join(repo, ".venv", "lib", "site-packages", "fastapi"), { recursive: true });
    writeFileSync(join(repo, path), "x\n");

    // Created vs Changed is not cosmetic: basedpyright rescans its search paths for *new* packages
    // Only when a batch carries a Create. A pure-Change batch downgrades it to a content-only reload,
    // Which re-reads what it already knew and never finds the package just installed (#277).
    expect(watchedFileChanges(registrations, repo, [{ path, renamed: true }], NOT_TRACKED)).toEqual(
      [{ type: 1, uri: pathToFileURL(join(repo, path)).href }],
    );
  });
});

test("an in-place rewrite is forwarded as Changed", () => {
  withRepo((repo) => {
    const registrations = parseWatcherRegistrations(pyrightRegistration(), repo);
    writeFileSync(join(repo, "main.py"), "x\n");

    // The converse of the above: an ordinary edit must stay a Change, or every save would push
    // Pyright's source watcher from a cheap dirty-mark into a full reanalysis.
    expect(
      watchedFileChanges(registrations, repo, [{ path: "main.py", renamed: false }], NOT_TRACKED),
    ).toEqual([{ type: 2, uri: pathToFileURL(join(repo, "main.py")).href }]);
  });
});

test("a vanished path is forwarded as Deleted, even though git still tracks it", () => {
  withRepo((repo) => {
    const registrations = parseWatcherRegistrations(pyrightRegistration(), repo);

    // The path is gone but git still knows it, so the tiebreak says "not an appearance". The disk,
    // Not the flag, has the final say: reporting a deleted file as a Change would strand its
    // Diagnostics on screen forever. This is the invariant that matching-before-typing must not lose.
    expect(
      watchedFileChanges(registrations, repo, [{ path: "gone.py", renamed: true }], TRACKED),
    ).toEqual([{ type: 3, uri: pathToFileURL(join(repo, "gone.py")).href }]);
  });
});

test("an atomic save over a tracked path is a Change, not an appearance", () => {
  withRepo((repo) => {
    const registrations = parseWatcherRegistrations(pyrightRegistration(), repo);
    writeFileSync(join(repo, "main.py"), "x\n");

    // Vim and most formatters write a temp file and rename it over the original, so `fs.watch` calls
    // An ordinary save a rename. Git already knowing the path is what separates that from a new file.
    expect(
      watchedFileChanges(registrations, repo, [{ path: "main.py", renamed: true }], TRACKED),
    ).toEqual([{ type: 2, uri: pathToFileURL(join(repo, "main.py")).href }]);
  });
});

test("a watcher only hears the change kinds it registered for", () => {
  withRepo((repo) => {
    // WatchKind is a bitmask (1 create, 2 change, 4 delete). A server that registers creates only is
    // Asking not to be dragged into a full reanalysis on every save, and honoring it is the client's
    // Job. Deferring the kind check until after the path matched must not weaken it.
    const registrations = parseWatcherRegistrations(
      {
        registrations: [
          {
            id: "creates-only",
            method: "workspace/didChangeWatchedFiles",
            registerOptions: { watchers: [{ globPattern: "**", kind: 1 }] },
          },
        ],
      },
      repo,
    );
    writeFileSync(join(repo, "main.py"), "x\n");

    expect(
      watchedFileChanges(registrations, repo, [{ path: "main.py", renamed: true }], NOT_TRACKED),
    ).toEqual([{ type: 1, uri: pathToFileURL(join(repo, "main.py")).href }]);
    expect(
      watchedFileChanges(registrations, repo, [{ path: "main.py", renamed: false }], NOT_TRACKED),
    ).toEqual([]);
    expect(
      watchedFileChanges(registrations, repo, [{ path: "gone.py", renamed: true }], NOT_TRACKED),
    ).toEqual([]);
  });
});

test("a batch no watcher claimed produces nothing", () => {
  withRepo((repo) => {
    writeFileSync(join(repo, "main.py"), "x\n");

    // A server that registered nothing must cost nothing: its paths are never even typed, which is
    // What keeps an install's tens of thousands of writes off the render thread in every repo whose
    // Servers do not consume this channel (after the rust-analyzer pin, all but basedpyright).
    expect(watchedFileChanges([], repo, [{ path: "main.py", renamed: true }], NOT_TRACKED)).toEqual(
      [],
    );
  });
});
