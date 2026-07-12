import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";

import {
  matchesWatchers,
  outOfTreeBases,
  parseWatcherRegistrations,
  parseWatcherUnregistrations,
  watchedFileEvent,
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

test("pyright's catch-all glob matches a package installed into an in-repo venv", () => {
  const registrations = parseWatcherRegistrations(pyrightRegistration(), REPO);

  expect(
    matchesWatchers(registrations, {
      path: join(REPO, ".venv", "lib", "python3.14", "site-packages", "fastapi", "__init__.py"),
      type: 2,
    }),
  ).toBe(true);
  expect(matchesWatchers(registrations, { path: join(REPO, "pyrightconfig.json"), type: 2 })).toBe(
    true,
  );
  expect(matchesWatchers(registrations, { path: join(REPO, "src", "main.py"), type: 2 })).toBe(
    true,
  );
});

test("a path outside the worktree does not match a worktree-relative glob", () => {
  const registrations = parseWatcherRegistrations(pyrightRegistration(), REPO);

  expect(matchesWatchers(registrations, { path: join(sep, "elsewhere", "main.py"), type: 2 })).toBe(
    false,
  );
});

test("a RelativePattern matches only under its own base", () => {
  const venv = join(sep, "home", "me", ".virtualenvs", "app", "lib", "site-packages");
  const registrations = parseWatcherRegistrations(pyrightRegistration([venv]), REPO);

  expect(
    matchesWatchers(registrations, { path: join(venv, "fastapi", "__init__.py"), type: 2 }),
  ).toBe(true);
  expect(
    matchesWatchers(registrations, { path: join(sep, "home", "me", "unrelated.py"), type: 2 }),
  ).toBe(false);
});

test("out-of-tree bases are the ones the worktree watcher cannot see", () => {
  const venv = join(sep, "home", "me", ".virtualenvs", "app");
  const inRepo = join(REPO, ".venv");
  const registrations = parseWatcherRegistrations(pyrightRegistration([venv, inRepo]), REPO);

  // The in-repo base rides the worktree watcher already; only the external one needs its own watch.
  expect(outOfTreeBases(registrations, REPO)).toEqual([venv]);
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
  expect(matchesWatchers(registrations, { path: join(REPO, "Cargo.toml"), type: 2 })).toBe(true);
});

test("a server that registers nothing matches nothing", () => {
  expect(matchesWatchers([], { path: join(REPO, "src", "main.py"), type: 2 })).toBe(false);
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

test("a path that appeared is Created, a rewrite is Changed, a vanished path is Deleted", () => {
  const dir = mkdtempSync(join(tmpdir(), "watched-files-"));
  const present = join(dir, "fastapi.py");
  writeFileSync(present, "x\n");
  try {
    // Created vs Changed is not cosmetic: basedpyright rescans its search paths for *new* packages
    // Only when a batch carries a Create. A pure-Change batch downgrades it to a content-only reload,
    // Which re-reads what it already knew and never finds the package just installed (#277).
    expect(watchedFileEvent(present, true)).toEqual({ path: present, type: 1 });
    // And the converse: an ordinary in-place edit must stay a Change, or every save would push
    // Pyright's source watcher from a cheap dirty-mark into a full reanalysis.
    expect(watchedFileEvent(present, false)).toEqual({ path: present, type: 2 });

    const gone = join(dir, "removed.py");
    expect(watchedFileEvent(gone, true)).toEqual({ path: gone, type: 3 });
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("a watcher only hears the change kinds it registered for", () => {
  // WatchKind is a bitmask (1 create, 2 change, 4 delete). A server that registers creates only is
  // Asking not to be dragged into a full reanalysis on every save, and honoring it is the client's job.
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
    REPO,
  );
  const path = join(REPO, "src", "main.py");

  expect(matchesWatchers(registrations, { path, type: 1 })).toBe(true);
  expect(matchesWatchers(registrations, { path, type: 2 })).toBe(false);
  expect(matchesWatchers(registrations, { path, type: 3 })).toBe(false);
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
  expect(matchesWatchers(registrations, { path: join(stdlib, "json", "tool.py"), type: 2 })).toBe(
    true,
  );
  expect(matchesWatchers(registrations, { path: join(REPO, "main.py"), type: 2 })).toBe(false);
});
