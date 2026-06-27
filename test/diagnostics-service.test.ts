import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect, Layer, Stream } from "effect";

import type { CheckerFileState } from "../src/diagnostics/checker";
import { LanguageServers, ServerInstalling, ServerUnavailable } from "../src/diagnostics/servers";
import type { ServerHandle } from "../src/diagnostics/servers";
import { Diagnostics, DiagnosticsLive } from "../src/diagnostics/service";
import type { LspConnection } from "../src/diagnostics/transport";
import type { ChangedFile } from "../src/git/model";

function changed(path: string): ChangedFile {
  return {
    additions: 1,
    binary: false,
    deletions: 0,
    kind: "modified",
    mtimeMs: 0,
    path,
    stage: "unstaged",
    warnings: [],
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// A push server: it publishes the given items for a document as soon as the client opens it, exactly
// As typescript-language-server does. A real LspConnection, not a mock of sideye's own code.
function pushingHandle(items: unknown[]): ServerHandle {
  const published = new Map<string, unknown[]>();
  const connection: LspConnection = {
    clearPublished: (uris) =>
      Effect.sync(() => {
        for (const uri of uris) {
          published.delete(uri);
        }
      }),
    closed: Effect.sync(() => false),
    notify: (method, params) =>
      Effect.sync(() => {
        if (
          method === "textDocument/didOpen" &&
          isObject(params) &&
          isObject(params.textDocument) &&
          typeof params.textDocument.uri === "string"
        ) {
          published.set(params.textDocument.uri, items);
        }
      }),
    published: Effect.sync(() => published),
    request: () => Effect.succeed(null),
  };
  return { connection, supportsPullDiagnostics: false };
}

// A server whose stdout has closed (it died): it never publishes and reports closed, so the settle
// Loop short-circuits instead of waiting out the cap.
function deadHandle(): ServerHandle {
  const connection: LspConnection = {
    clearPublished: () => Effect.void,
    closed: Effect.sync(() => true),
    notify: () => Effect.void,
    published: Effect.sync(() => new Map<string, unknown[]>()),
    request: () => Effect.succeed(null),
  };
  return { connection, supportsPullDiagnostics: false };
}

function collectUpdates(
  repoRoot: string,
  files: ChangedFile[],
  servers: Layer.Layer<LanguageServers>,
  prior?: ReadonlyMap<string, CheckerFileState>,
) {
  return Effect.runPromise(
    Diagnostics.pipe(
      Effect.flatMap((diagnostics) => Stream.runCollect(diagnostics.run(repoRoot, files, prior))),
      Effect.map((updates) => [...updates]),
      Effect.provide(DiagnosticsLive.pipe(Layer.provide(servers))),
    ),
  );
}

// The run streams a snapshot per server as it finishes; the last one is the fully-merged state.
async function runDiagnostics(
  repoRoot: string,
  files: ChangedFile[],
  servers: Layer.Layer<LanguageServers>,
) {
  const updates = await collectUpdates(repoRoot, files, servers);
  return updates.at(-1)?.state ?? new Map<string, CheckerFileState>();
}

// Language-aware fake: each server publishes for the files of its own language, and a language with
// No handle degrades to unavailable, exactly as a missing server would. Lets one test exercise the
// Typescript + oxlint merge a real `.ts` file now triggers.
function fakeServers(byLanguage: Record<string, ServerHandle>) {
  return Layer.succeed(LanguageServers)({
    acquire: (language) => {
      const handle = byLanguage[language];
      return handle === undefined
        ? Effect.fail(new ServerUnavailable({ language, message: "not found" }))
        : Effect.succeed(handle);
    },
  });
}

function withRepo(files: Record<string, string>, run: (dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "diag-lsp-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return run(dir).finally(() => rmSync(dir, { force: true, recursive: true }));
}

const anError = {
  message: "Type error",
  range: { end: { character: 7, line: 0 }, start: { character: 6, line: 0 } },
  severity: 1,
  source: "ts",
};

const aLintWarning = {
  message: "`debugger` statement is not allowed",
  range: { end: { character: 1, line: 1 }, start: { character: 0, line: 1 } },
  severity: 2,
  source: "oxc",
};

test("maps a pushed diagnostic onto the changed file as findings", async () => {
  await withRepo({ "src/a.ts": "const a: string = 1\n" }, async (dir) => {
    const state = await runDiagnostics(
      dir,
      [changed("src/a.ts")],
      fakeServers({ typescript: pushingHandle([anError]) }),
    );
    const fileState = state.get("src/a.ts");
    expect(fileState?.status).toBe("findings");
    expect(fileState?.diagnostics[0]).toMatchObject({
      line: 1,
      message: "Type error",
      severity: "error",
      source: "ts",
    });
  });
});

test("merges findings from every server that handles the file", async () => {
  await withRepo({ "src/a.ts": "const a: string = 1\n" }, async (dir) => {
    const state = await runDiagnostics(
      dir,
      [changed("src/a.ts")],
      fakeServers({
        oxlint: pushingHandle([aLintWarning]),
        typescript: pushingHandle([anError]),
      }),
    );
    const fileState = state.get("src/a.ts");
    expect(fileState?.status).toBe("findings");
    expect(fileState?.diagnostics).toHaveLength(2);
    expect(fileState?.diagnostics.map((diagnostic) => diagnostic.source).toSorted()).toEqual([
      "oxc",
      "ts",
    ]);
  });
});

test("streams a snapshot per server as each finishes, not one combined update", async () => {
  await withRepo({ "src/a.ts": "const a = 1\n" }, async (dir) => {
    const updates = await collectUpdates(
      dir,
      [changed("src/a.ts")],
      fakeServers({
        oxlint: pushingHandle([aLintWarning]),
        typescript: pushingHandle([]),
      }),
    );
    // Two servers handle the file, so it surfaces two progressive snapshots rather than one.
    expect(updates).toHaveLength(2);
    // Every emission is a complete snapshot covering the file, and the last is fully merged.
    expect(updates[0]?.state.get("src/a.ts")).toBeDefined();
    expect(updates.at(-1)?.state.get("src/a.ts")?.status).toBe("findings");
  });
});

test("holds a file's prior badge while a slower server is still running", async () => {
  await withRepo({ "src/a.ts": "const a = 1\n" }, async (dir) => {
    // Delay typescript so oxlint deterministically finishes first, leaving an emission mid-run.
    const servers = Layer.succeed(LanguageServers)({
      acquire: (language) => {
        const handle = pushingHandle([]); // Both servers report clean
        return language === "typescript"
          ? Effect.succeed(handle).pipe(Effect.delay("30 millis"))
          : Effect.succeed(handle);
      },
    });
    const prior = new Map<string, CheckerFileState>([
      ["src/a.ts", { count: 1, diagnostics: [], status: "findings" }],
    ]);
    const updates = await collectUpdates(dir, [changed("src/a.ts")], servers, prior);
    // First emission (oxlint done, typescript still running): the file holds its prior badge, not pending.
    expect(updates[0]?.state.get("src/a.ts")?.status).toBe("findings");
    // Final emission (both done, both clean): the held badge resolves to clean.
    expect(updates.at(-1)?.state.get("src/a.ts")?.status).toBe("clean");
  });
});

test("reports a file the server publishes no items for as clean", async () => {
  await withRepo({ "src/a.ts": "const a = 1\n" }, async (dir) => {
    const state = await runDiagnostics(
      dir,
      [changed("src/a.ts")],
      fakeServers({ oxlint: pushingHandle([]), typescript: pushingHandle([]) }),
    );
    expect(state.get("src/a.ts")?.status).toBe("clean");
  });
});

test("stays clean when one server resolves clean and another is unavailable", async () => {
  await withRepo({ "src/a.ts": "const a = 1\n" }, async (dir) => {
    // Only typescript is present; oxlint degrades to unavailable but must not override the clean result.
    const state = await runDiagnostics(
      dir,
      [changed("src/a.ts")],
      fakeServers({ typescript: pushingHandle([]) }),
    );
    expect(state.get("src/a.ts")?.status).toBe("clean");
  });
});

test("marks a file with no language server as unavailable, never clean", async () => {
  await withRepo({ "docs/readme.md": "# hi\n" }, async (dir) => {
    const state = await runDiagnostics(dir, [changed("docs/readme.md")], fakeServers({}));
    expect(state.get("docs/readme.md")?.status).toBe("unavailable");
  });
});

test("leaves a file the server has not published for as pending, never clean", async () => {
  await withRepo({ "src/a.ts": "const a = 1\n" }, async (dir) => {
    const state = await runDiagnostics(
      dir,
      [changed("src/a.ts")],
      fakeServers({ oxlint: deadHandle(), typescript: deadHandle() }),
    );
    expect(state.get("src/a.ts")?.status).toBe("pending");
  });
});

test("leaves files pending with a message while the server is downloading", async () => {
  await withRepo({ "src/a.ts": "const a = 1\n" }, async (dir) => {
    const installing = Layer.succeed(LanguageServers)({
      acquire: () => Effect.fail(new ServerInstalling({ language: "typescript" })),
    });
    const state = await runDiagnostics(dir, [changed("src/a.ts")], installing);
    const fileState = state.get("src/a.ts");
    expect(fileState?.status).toBe("pending");
    expect(fileState?.message).toContain("installing");
  });
});

test("degrades to unavailable when the server cannot be acquired", async () => {
  await withRepo({ "src/a.ts": "const a = 1\n" }, async (dir) => {
    const failing = Layer.succeed(LanguageServers)({
      acquire: () =>
        Effect.fail(
          new ServerUnavailable({
            language: "typescript",
            message: "not found",
          }),
        ),
    });
    const state = await runDiagnostics(dir, [changed("src/a.ts")], failing);
    expect(state.get("src/a.ts")?.status).toBe("unavailable");
  });
});
