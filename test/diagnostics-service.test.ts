import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect, Layer, Stream } from "effect";

import type { CheckerFileState } from "../src/diagnostics/checker";
import {
  LanguageServers,
  ServerInstalling,
  ServerUnavailable,
  type ServerHandle,
} from "../src/diagnostics/servers";
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

function runDiagnostics(
  repoRoot: string,
  files: ChangedFile[],
  servers: Layer.Layer<LanguageServers>,
) {
  return Effect.runPromise(
    Diagnostics.pipe(
      Effect.flatMap((diagnostics) => Stream.runCollect(diagnostics.run(repoRoot, files))),
      Effect.map((updates) => [...updates][0]?.state ?? new Map<string, CheckerFileState>()),
      Effect.provide(DiagnosticsLive.pipe(Layer.provide(servers))),
    ),
  );
}

function fakeServers(handle: ServerHandle) {
  return Layer.succeed(LanguageServers)({ acquire: () => Effect.succeed(handle) });
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

test("maps a pushed diagnostic onto the changed file as findings", async () => {
  await withRepo({ "src/a.ts": "const a: string = 1\n" }, async (dir) => {
    const state = await runDiagnostics(
      dir,
      [changed("src/a.ts")],
      fakeServers(pushingHandle([anError])),
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

test("reports a file the server publishes no items for as clean", async () => {
  await withRepo({ "src/a.ts": "const a = 1\n" }, async (dir) => {
    const state = await runDiagnostics(dir, [changed("src/a.ts")], fakeServers(pushingHandle([])));
    expect(state.get("src/a.ts")?.status).toBe("clean");
  });
});

test("marks a file with no language server as unavailable, never clean", async () => {
  await withRepo({ "docs/readme.md": "# hi\n" }, async (dir) => {
    const state = await runDiagnostics(
      dir,
      [changed("docs/readme.md")],
      fakeServers(pushingHandle([])),
    );
    expect(state.get("docs/readme.md")?.status).toBe("unavailable");
  });
});

test("leaves a file the server has not published for as pending, never clean", async () => {
  await withRepo({ "src/a.ts": "const a = 1\n" }, async (dir) => {
    const state = await runDiagnostics(dir, [changed("src/a.ts")], fakeServers(deadHandle()));
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
        Effect.fail(new ServerUnavailable({ language: "typescript", message: "not found" })),
    });
    const state = await runDiagnostics(dir, [changed("src/a.ts")], failing);
    expect(state.get("src/a.ts")?.status).toBe("unavailable");
  });
});
