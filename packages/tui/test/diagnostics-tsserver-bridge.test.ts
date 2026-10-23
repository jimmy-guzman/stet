import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { Effect, Layer, Queue, Stream } from "effect";

import { LspProcess } from "@/diagnostics/lsp-process";
import { Provisioner } from "@/diagnostics/provision";
import {
  LanguageServers,
  LanguageServersLive,
  registerServers,
  restoreServers,
  snapshotServers,
} from "@/diagnostics/servers";
import type { ServerSpec } from "@/diagnostics/servers";
import { LspRequestError } from "@/diagnostics/transport";
import type { LspConnection, NotificationHandler } from "@/diagnostics/transport";
import { parseTsserverRequest } from "@/diagnostics/tsserver-bridge";

test("a tsserver/request is read from the nested triple vue-language-server sends", () => {
  /** Measured from @vue/language-server@3.3.12: one array argument, wrapped once more on the wire. */
  expect(
    parseTsserverRequest([
      [1, "_vue:projectInfo", { file: "/r/App.vue", needFileNameList: false }],
    ]),
  ).toEqual({
    args: { file: "/r/App.vue", needFileNameList: false },
    command: "_vue:projectInfo",
    id: 1,
  });
  expect(parseTsserverRequest([1, "_vue:projectInfo", {}])).toBeUndefined();
  expect(parseTsserverRequest([["1", "_vue:projectInfo", {}]])).toBeUndefined();
  expect(parseTsserverRequest(undefined)).toBeUndefined();
});

interface Recorded {
  readonly events: string[];
  readonly executed: unknown[];
}

/**
 * A tsserver connection that records what the bridge sends it. A `dying` one fails its first
 * command with the error a connection whose child died gives, and reads as closed from then on. No
 * process, no mocks.
 */
function tsConnection(recorded: Recorded, dying = false): LspConnection {
  const state = { closed: false };
  return {
    changeDocument: () => Effect.void,
    clearPublished: () => Effect.void,
    closeDocument: (uri) => Effect.sync(() => void recorded.events.push(`close ${uri}`)),
    closed: Effect.sync(() => state.closed),
    endPublishWait: Effect.void,
    notify: () => Effect.void,
    openDocument: (doc) =>
      Effect.sync(() => void recorded.events.push(`open ${doc.uri}`)).pipe(Effect.as(true)),
    published: Effect.sync(() => new Map<string, unknown[]>()),
    pullDiagnostics: () => Effect.die("unused"),
    request: (method, params) => {
      if (method !== "workspace/executeCommand") {
        return Effect.succeed(method === "initialize" ? { capabilities: {} } : null);
      }
      if (dying) {
        state.closed = true;
        return Effect.fail(new LspRequestError({ message: "connection closed", method }));
      }
      return Effect.sync(() => {
        recorded.events.push("execute");
        recorded.executed.push(params);
        return { body: { configFileName: "/repo/tsconfig.json" }, success: true };
      });
    },
    watchedBases: Stream.empty,
    watchedFilesChanged: () => Effect.void,
    whenProjectLoaded: Effect.void,
  };
}

/**
 * The pool over a fake `LspProcess`: `tsfake` is the tsserver host (its connection records into
 * `recorded`), `vuefake` the bridged server, whose notification handler is captured for the test to
 * drive the way its transport would.
 */
function bridgeScenario(
  servers: Record<string, ServerSpec>,
  tsDies: "never" | "first" | "always" = "never",
) {
  const recorded: Recorded = { events: [], executed: [] };
  const handlers: NotificationHandler[] = [];
  const rechecks: string[] = [];
  const tsSpawns: string[] = [];
  const lspProcess = Layer.effect(
    LspProcess,
    Effect.gen(function* fake() {
      const refreshes = yield* Queue.unbounded<string>();
      return {
        refreshes,
        start: (command, _cwd, _onRequest, onNotification) =>
          Effect.sync(() => {
            if (command.includes("tsfake")) {
              tsSpawns.push("tsfake");
              return tsConnection(
                recorded,
                tsDies === "always" || (tsDies === "first" && tsSpawns.length === 1),
              );
            }
            if (onNotification !== undefined) {
              handlers.push(onNotification);
            }
            return tsConnection({ events: [], executed: [] });
          }),
      };
    }),
  );
  const provisioner = Layer.effect(
    Provisioner,
    Effect.gen(function* fake() {
      return {
        completions: yield* Queue.unbounded<string>(),
        ensure: () => Effect.succeed({ kind: "failed" as const, message: "no channel" }),
        ensurePlugin: () => Effect.succeed({ kind: "installing" as const }),
        starts: yield* Queue.unbounded<string>(),
      };
    }),
  );
  registerServers(servers);
  const layer = LanguageServersLive.pipe(
    Layer.provideMerge(Layer.mergeAll(lspProcess, provisioner)),
  );

  /** Deliver one `tsserver/request` to the newest bridged server, collecting what it answers. */
  const deliver = (params: unknown) =>
    Effect.gen(function* answer() {
      const answers: unknown[] = [];
      const handler = handlers.at(-1);
      if (handler !== undefined) {
        yield* handler("tsserver/request", params, {
          notify: (method, body) => Effect.sync(() => void answers.push({ body, method })),
          recheck: Effect.sync(() => void rechecks.push("recheck")),
        });
      }
      return answers;
    });

  /** Acquire the bridged server in a fresh pool and deliver one request to it. */
  const ask = (repo: string, params: unknown) =>
    Effect.runPromise(
      Effect.scoped(
        LanguageServers.pipe(
          Effect.flatMap((pool) => pool.acquire("vuefake", repo)),
          Effect.andThen(deliver(params)),
        ),
      ).pipe(Effect.provide(layer)),
    );
  return { ask, deliver, handlers, layer, rechecks, recorded, tsSpawns: () => tsSpawns.length };
}

/** `bun` resolves on PATH, so both fakes take the discovery path; the args only tell them apart. */
const vueSpec: ServerSpec = {
  args: ["vuefake"],
  binary: "bun",
  provides: [],
  tsserverBridge: { plugin: "fake-plugin", server: "tsfake" },
};
const tsSpec: ServerSpec = {
  args: ["tsfake"],
  binary: "bun",
  plugins: [{ name: "fake-plugin", when: "package.json" }],
  provides: [],
};

function pluginRepo() {
  const repo = mkdtempSync(join(tmpdir(), "stet-bridge-"));
  writeFileSync(join(repo, "package.json"), "{}");
  mkdirSync(join(repo, "node_modules", "fake-plugin"), { recursive: true });
  writeFileSync(join(repo, "node_modules", "fake-plugin", "package.json"), "{}");
  mkdirSync(join(repo, "src"));
  writeFileSync(join(repo, "src", "App.vue"), "<template><p></template>\n");
  return repo;
}

test("a tsserver/request runs in the sibling tsserver, with the file open there, and is answered", async () => {
  const snapshot = snapshotServers();
  const repo = pluginRepo();
  const file = join(repo, "src", "App.vue");
  const uri = pathToFileURL(file).href;
  try {
    const { ask, rechecks, recorded } = bridgeScenario({ tsfake: tsSpec, vuefake: vueSpec });
    const answers = await ask(repo, [[7, "_vue:projectInfo", { file, needFileNameList: false }]]);

    /**
     * Measured against typescript-language-server@5.3.0: the command and the options object it
     * takes alongside tsserver's own command and arguments.
     */
    expect(recorded.executed).toEqual([
      {
        arguments: [
          "_vue:projectInfo",
          { file, needFileNameList: false },
          { isAsync: true, lowPriority: true },
        ],
        command: "typescript.tsserverRequest",
      },
    ]);
    /** The open lands before the command: tsserver answers only for a document it has open. */
    expect(recorded.events).toEqual([`open ${uri}`, "execute", `close ${uri}`]);
    expect(answers).toEqual([
      { body: [[7, { configFileName: "/repo/tsconfig.json" }]], method: "tsserver/response" },
    ]);
    expect(rechecks).toEqual(["recheck"]);
  } finally {
    restoreServers(snapshot);
    rmSync(repo, { force: true, recursive: true });
  }
});

test("a tsserver without the plugin is answered null at once, and the bridged server is rebuilt once the plugin lands", async () => {
  const snapshot = snapshotServers();
  const repo = pluginRepo();
  const plugin = join(repo, "node_modules", "fake-plugin");
  rmSync(plugin, { force: true, recursive: true });
  try {
    const { deliver, handlers, layer, recorded } = bridgeScenario({
      tsfake: tsSpec,
      vuefake: vueSpec,
    });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* scenario() {
          const pool = yield* LanguageServers;
          const vue = yield* pool.acquire("vuefake", repo);
          const answers = yield* deliver([
            [3, "_vue:projectInfo", { file: join(repo, "src", "App.vue") }],
          ]);
          expect(answers).toEqual([{ body: [[3, null]], method: "tsserver/response" }]);
          expect(recorded.executed).toEqual([]);
          expect(yield* vue.stale).toBe(false);

          /**
           * The plugin lands, the way a provisioned install does. The bridged server cached the
           * `null`, so only a fresh process can pick up the project.
           */
          mkdirSync(plugin, { recursive: true });
          writeFileSync(join(plugin, "package.json"), "{}");
          expect(yield* vue.stale).toBe(true);
          yield* pool.acquire("vuefake", repo);
          expect(handlers).toHaveLength(2);
        }),
      ).pipe(Effect.provide(layer)),
    );
  } finally {
    restoreServers(snapshot);
    rmSync(repo, { force: true, recursive: true });
  }
});

test("a tsserver that dies mid-forward is rebuilt and asked again, not answered null", async () => {
  const snapshot = snapshotServers();
  const repo = pluginRepo();
  try {
    const { ask, recorded, tsSpawns } = bridgeScenario(
      { tsfake: tsSpec, vuefake: vueSpec },
      "first",
    );
    const answers = await ask(repo, [
      [5, "_vue:projectInfo", { file: join(repo, "src", "App.vue") }],
    ]);

    /** The bridged server caches whatever it is told for the file, so a `null` here would stick. */
    expect(tsSpawns()).toBe(2);
    expect(recorded.executed).toHaveLength(1);
    expect(answers).toEqual([
      { body: [[5, { configFileName: "/repo/tsconfig.json" }]], method: "tsserver/response" },
    ]);
  } finally {
    restoreServers(snapshot);
    rmSync(repo, { force: true, recursive: true });
  }
});

test("a tsserver that dies on every request is rebuilt a few times, then answered null", async () => {
  const snapshot = snapshotServers();
  const repo = pluginRepo();
  try {
    const { ask, recorded, tsSpawns } = bridgeScenario(
      { tsfake: tsSpec, vuefake: vueSpec },
      "always",
    );
    const answers = await ask(repo, [
      [6, "_vue:projectInfo", { file: join(repo, "src", "App.vue") }],
    ]);

    expect(tsSpawns()).toBe(4);
    expect(recorded.executed).toEqual([]);
    expect(answers).toEqual([{ body: [[6, null]], method: "tsserver/response" }]);
  } finally {
    restoreServers(snapshot);
    rmSync(repo, { force: true, recursive: true });
  }
});

test("a tsserver host that cannot run is answered null, so the request never hangs", async () => {
  const snapshot = snapshotServers();
  const repo = pluginRepo();
  try {
    const { ask, recorded } = bridgeScenario({
      tsfake: { ...tsSpec, binary: "stet-no-such-server" },
      vuefake: vueSpec,
    });
    const answers = await ask(repo, [
      [9, "_vue:projectInfo", { file: join(repo, "src", "App.vue") }],
    ]);

    expect(recorded.executed).toEqual([]);
    expect(answers).toEqual([{ body: [[9, null]], method: "tsserver/response" }]);
  } finally {
    restoreServers(snapshot);
    rmSync(repo, { force: true, recursive: true });
  }
});
