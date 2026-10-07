import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { Effect, Exit, Layer, Queue, Stream } from "effect";

import { LspProcess } from "@/diagnostics/lsp-process";
import { Provisioner, provisionKey } from "@/diagnostics/provision";
import { builtinSchemas } from "@/diagnostics/schemas";
import {
  activePlugins,
  activeServerGates,
  activeServersForPath,
  handshakeConfigFor,
  LanguageServers,
  LanguageServersLive,
  loadedPlugins,
  lspLanguageId,
  performHandshake,
  pluginLocation,
  registry,
  registerServers,
  resolveServerCommand,
  resolveServers,
  restoreServers,
  serverRepoKey,
  serversForPath,
  serversProviding,
  snapshotServers,
} from "@/diagnostics/servers";
import { LspRequestError } from "@/diagnostics/transport";
import type { LspConnection } from "@/diagnostics/transport";

test("resolves a source file to its language's servers in declared order", () => {
  // The JS/TS family lists its canonical server first, then the linters that overlap it.
  expect(serversForPath("src/a.tsx")).toEqual(["typescript", "oxlint", "biome"]);
  expect(serversForPath("src/a.mjs")).toEqual(["typescript", "oxlint", "biome"]);
  // Only biome claims css/graphql; the language matcher includes it regardless of repo gating.
  expect(serversForPath("src/a.css")).toEqual(["biome"]);
  // Json overlaps biome (biome only in a biome repo, the json server everywhere); yaml is disjoint.
  expect(serversForPath("package.json")).toEqual(["json", "biome"]);
  expect(serversForPath("config.yaml")).toEqual(["yaml"]);
  expect(serversForPath("config.yml")).toEqual(["yaml"]);
  expect(serversForPath("README.md")).toEqual([]);
  expect(serversForPath("Makefile")).toEqual([]);
});

test("plain Python repos select basedpyright while retaining ty as a possible server", async () => {
  const repo = mkdtempSync(join(tmpdir(), "stet-python-"));
  try {
    expect(serversForPath("src/main.py")).toEqual(["ty", "basedpyright", "ruff"]);
    expect(serversForPath("stubs/typed.pyi")).toEqual(["ty", "basedpyright", "ruff"]);
    expect(await Effect.runPromise(activeServersForPath("src/main.py", repo))).toEqual([
      "basedpyright",
      "ruff",
    ]);
    expect(await Effect.runPromise(activeServersForPath("stubs/typed.pyi", repo))).toEqual([
      "basedpyright",
      "ruff",
    ]);
    expect(lspLanguageId("src/main.py")).toBe("python");
    expect(lspLanguageId("stubs/typed.pyi")).toBe("python");
    // Ruff answers hover too, so both surface for a hover pull; references stays basedpyright's.
    expect(await Effect.runPromise(serversProviding("src/main.py", "hover", repo))).toEqual([
      "basedpyright",
      "ruff",
    ]);
    expect(await Effect.runPromise(serversProviding("src/main.py", "references", repo))).toEqual([
      "basedpyright",
    ]);
    expect(
      await Effect.runPromise(serversProviding("src/main.py", "implementation", repo)),
    ).toEqual(["basedpyright"]);
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});

test("every built-in ty signal selects ty instead of basedpyright", async () => {
  const repositories = [
    { file: "ty.toml", text: "" },
    { file: ".ty.toml", text: "" },
    { file: "pyproject.toml", text: "[tool.ty]\n" },
    { file: "pyproject.toml", text: '[dependency-groups]\ndev = ["ty>=0.0.58"]\n' },
  ].map(({ file, text }) => {
    const repo = mkdtempSync(join(tmpdir(), "stet-ty-"));
    writeFileSync(join(repo, file), text);
    return repo;
  });

  try {
    await Promise.all(
      repositories.map(async (repo) => {
        expect(await Effect.runPromise(activeServersForPath("src/main.py", repo))).toEqual([
          "ty",
          "ruff",
        ]);
        expect(await Effect.runPromise(serversProviding("src/main.py", "hover", repo))).toEqual([
          "ty",
          "ruff",
        ]);
        expect(
          await Effect.runPromise(serversProviding("src/main.py", "implementation", repo)),
        ).toEqual([]);
      }),
    );
  } finally {
    for (const repo of repositories) {
      rmSync(repo, { force: true, recursive: true });
    }
  }
});

test("activeServersForPath gates biome on a repo's biome config", async () => {
  const withConfig = mkdtempSync(join(tmpdir(), "stet-biome-"));
  const withJsonc = mkdtempSync(join(tmpdir(), "stet-biome-"));
  const without = mkdtempSync(join(tmpdir(), "stet-biome-"));
  writeFileSync(join(withConfig, "biome.json"), "{}");
  writeFileSync(join(withJsonc, "biome.jsonc"), "{}");

  try {
    // A biome.json (or biome.jsonc) opts the repo in; biome then handles the JS/TS family and css.
    expect(await Effect.runPromise(activeServersForPath("src/a.ts", withConfig))).toEqual([
      "typescript",
      "oxlint",
      "biome",
    ]);
    expect(await Effect.runPromise(activeServersForPath("src/a.css", withJsonc))).toEqual([
      "biome",
    ]);
    // Without a biome config, biome stays off: oxlint/typescript still run, css has no server.
    expect(await Effect.runPromise(activeServersForPath("src/a.ts", without))).toEqual([
      "typescript",
      "oxlint",
    ]);
    expect(await Effect.runPromise(activeServersForPath("src/a.css", without))).toEqual([]);
  } finally {
    rmSync(withConfig, { force: true, recursive: true });
    rmSync(withJsonc, { force: true, recursive: true });
    rmSync(without, { force: true, recursive: true });
  }
});

test("watched changes refresh the shared server gates for a repository", async () => {
  const repo = mkdtempSync(join(tmpdir(), "stet-biome-watch-"));
  const refreshes = await Effect.runPromise(Queue.unbounded<string>());
  const starts = await Effect.runPromise(Queue.unbounded<string>());
  const completions = await Effect.runPromise(Queue.unbounded<string>());
  const layer = LanguageServersLive.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(LspProcess)({
          refreshes,
          start: () => Effect.die("unused"),
        }),
        Layer.succeed(Provisioner)({
          completions,
          ensure: () => Effect.die("unused"),
          ensurePlugin: () => Effect.die("unused"),
          starts,
        }),
      ),
    ),
  );

  try {
    expect(await Effect.runPromise(activeServersForPath("src/a.css", repo))).toEqual([]);
    writeFileSync(join(repo, "biome.json"), "{}");
    expect(await Effect.runPromise(activeServersForPath("src/a.css", repo))).toEqual([]);

    await Effect.runPromise(
      LanguageServers.use((servers) =>
        servers.notifyWatchedFiles(repo, [{ path: "biome.json", renamed: true }], () => false),
      ).pipe(Effect.provide(layer)),
    );

    expect(await Effect.runPromise(activeServersForPath("src/a.css", repo))).toEqual(["biome"]);
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});

test("only the intel-capable server answers a code-intel pull for a file", async () => {
  const repo = mkdtempSync(join(tmpdir(), "stet-intel-"));
  try {
    // TypeScript is the only registered server that provides code-intel, so a JS/TS-family file
    // Resolves to it regardless of the other extension-matching servers (oxlint, biome).
    expect(await Effect.runPromise(serversProviding("src/a.ts", "hover", repo))).toEqual([
      "typescript",
    ]);
    expect(await Effect.runPromise(serversProviding("src/a.tsx", "hover", repo))).toEqual([
      "typescript",
    ]);
    expect(await Effect.runPromise(serversProviding("src/a.mjs", "hover", repo))).toEqual([
      "typescript",
    ]);
    // CSS matches only intel-less biome (gated off here) and an extensionless file matches none.
    expect(await Effect.runPromise(serversProviding("src/a.css", "hover", repo))).toEqual([]);
    expect(await Effect.runPromise(serversProviding("Makefile", "hover", repo))).toEqual([]);
    // JSON and YAML answer hover (measured from their initialize replies), so they warm too.
    expect(await Effect.runPromise(serversProviding("package.json", "hover", repo))).toEqual([
      "json",
    ]);
    expect(await Effect.runPromise(serversProviding("config.yaml", "hover", repo))).toEqual([
      "yaml",
    ]);
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});

test("lspLanguageId maps non-JS/TS file types to their LSP language ids", () => {
  expect(lspLanguageId("a.json")).toBe("json");
  expect(lspLanguageId("a.jsonc")).toBe("jsonc");
  expect(lspLanguageId("a.css")).toBe("css");
  expect(lspLanguageId("a.graphql")).toBe("graphql");
  expect(lspLanguageId("a.yaml")).toBe("yaml");
  expect(lspLanguageId("a.yml")).toBe("yaml");
});

test("serversProviding keeps only servers whose static hint can answer the intent", async () => {
  const repo = mkdtempSync(join(tmpdir(), "stet-capabilities-"));
  try {
    // Only typescript declares definition/references; oxlint pushes diagnostics and declares neither,
    // So intel never acquires it for a code-intel pull.
    expect(await Effect.runPromise(serversProviding("src/a.ts", "definition", repo))).toEqual([
      "typescript",
    ]);
    expect(await Effect.runPromise(serversProviding("src/a.tsx", "references", repo))).toEqual([
      "typescript",
    ]);
    expect(await Effect.runPromise(serversProviding("src/a.ts", "implementation", repo))).toEqual([
      "typescript",
    ]);
    // Json answers hover and documentSymbol but not definition; yaml answers definition too. A
    // Capability the matched server does not declare still filters out.
    expect(await Effect.runPromise(serversProviding("package.json", "definition", repo))).toEqual(
      [],
    );
    expect(await Effect.runPromise(serversProviding("config.yaml", "definition", repo))).toEqual([
      "yaml",
    ]);
    expect(await Effect.runPromise(serversProviding("README.md", "definition", repo))).toEqual([]);
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});

test("resolveServerCommand returns undefined for a language with no registered server", () => {
  expect(resolveServerCommand("ruby", "/repo")).toBeUndefined();
});

test("Go source and module files route to gopls", async () => {
  const repo = mkdtempSync(join(tmpdir(), "stet-go-"));
  try {
    expect(serversForPath("main.go")).toEqual(["gopls"]);
    expect(serversForPath("go.mod")).toEqual(["gopls"]);
    expect(serversForPath("go.work")).toEqual(["gopls"]);
    // Always-on (no gate), so gopls stays selected in any repo.
    expect(await Effect.runPromise(activeServersForPath("main.go", repo))).toEqual(["gopls"]);
    // Each Go file type opens under its own LSP languageId; one pooled gopls serves all three.
    expect(lspLanguageId("main.go")).toBe("go");
    expect(lspLanguageId("go.mod")).toBe("go.mod");
    expect(lspLanguageId("go.work")).toBe("go.work");
    // Every code-intel pull stet makes resolves to gopls, implementation included.
    expect(await Effect.runPromise(serversProviding("main.go", "hover", repo))).toEqual(["gopls"]);
    expect(await Effect.runPromise(serversProviding("main.go", "definition", repo))).toEqual([
      "gopls",
    ]);
    expect(await Effect.runPromise(serversProviding("main.go", "implementation", repo))).toEqual([
      "gopls",
    ]);
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});

test("gopls is discovery-only and resolves from a repo-local binary", () => {
  // No provisioning channel: gopls ships no prebuilt binaries, so stet never downloads it.
  expect(registry.gopls?.provision).toBeUndefined();

  const repo = mkdtempSync(join(tmpdir(), "stet-go-bin-"));
  const bin = join(repo, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "gopls"), "");

  try {
    // A repo-local binary wins over PATH, so the resolution is deterministic even where gopls is
    // Installed globally; `args` is empty (bare `gopls` serves).
    expect(resolveServerCommand("gopls", repo)).toEqual([join(bin, "gopls")]);
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});

test("built-in Python servers resolve from the repository virtualenv", () => {
  const repo = mkdtempSync(join(tmpdir(), "stet-python-binaries-"));
  const bin = join(repo, ".venv", "bin");
  const previousVirtualEnv = process.env.VIRTUAL_ENV;
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "basedpyright-langserver"), "");
  writeFileSync(join(bin, "ruff"), "");
  writeFileSync(join(bin, "ty"), "");
  delete process.env.VIRTUAL_ENV;

  try {
    expect(resolveServerCommand("basedpyright", repo)).toEqual([
      join(bin, "basedpyright-langserver"),
      "--stdio",
    ]);
    expect(resolveServerCommand("ruff", repo)).toEqual([join(bin, "ruff"), "server"]);
    expect(resolveServerCommand("ty", repo)).toEqual([join(bin, "ty"), "server"]);
  } finally {
    if (previousVirtualEnv === undefined) {
      delete process.env.VIRTUAL_ENV;
    } else {
      process.env.VIRTUAL_ENV = previousVirtualEnv;
    }
    rmSync(repo, { force: true, recursive: true });
  }
});

test("handshake parses advertised providers into the capability set", async () => {
  const requested: string[] = [];
  const notified: string[] = [];
  let initializeParams: unknown;
  const connection: LspConnection = {
    changeDocument: () => Effect.void,
    clearPublished: () => Effect.void,
    closeDocument: () => Effect.void,
    closed: Effect.sync(() => false),
    endPublishWait: Effect.void,
    notify: (method) => Effect.sync(() => void notified.push(method)),
    openDocument: () => Effect.void,
    published: Effect.sync(() => new Map<string, unknown[]>()),
    pullDiagnostics: () =>
      Effect.fail(
        new LspRequestError({ message: "unsupported", method: "textDocument/diagnostic" }),
      ),
    request: (method, params) =>
      Effect.sync(() => {
        requested.push(method);
        initializeParams = method === "initialize" ? params : initializeParams;
        // A typescript-language-server-shaped reply: definition/references/hover as options
        // Objects, no diagnosticProvider (it pushes diagnostics instead).
        return method === "initialize"
          ? {
              capabilities: {
                definitionProvider: true,
                documentSymbolProvider: { label: "TypeScript" },
                hoverProvider: true,
                implementationProvider: true,
                referencesProvider: true,
              },
            }
          : null;
      }),
    watchedBases: Stream.empty,
    watchedFilesChanged: () => Effect.void,
    whenProjectLoaded: Effect.void,
  };

  const handle = await Effect.runPromise(performHandshake(connection, "/repo"));

  expect(handle.capabilities.has("definition")).toBe(true);
  expect(handle.capabilities.has("references")).toBe(true);
  expect(handle.capabilities.has("hover")).toBe(true);
  expect(handle.capabilities.has("documentSymbol")).toBe(true);
  expect(handle.capabilities.has("implementation")).toBe(true);
  expect(handle.capabilities.has("pullDiagnostics")).toBe(false);
  expect(requested).toEqual(["initialize"]);
  expect(notified).toEqual(["initialized"]);
  // Opting into workDoneProgress is what makes tsserver report project-load begin/end; without it
  // The intel readiness gate never opens.
  expect(initializeParams).toMatchObject({ capabilities: { window: { workDoneProgress: true } } });
  // The hierarchicalDocumentSymbolSupport flag is what makes a server return the nested
  // `DocumentSymbol[]`; without it the outline downgrades to a flat `SymbolInformation[]`.
  expect(initializeParams).toMatchObject({
    capabilities: {
      textDocument: { documentSymbol: { hierarchicalDocumentSymbolSupport: true } },
    },
  });
  // Basedpyright does no filesystem watching of its own and installs its watch feature only when the
  // Client advertises `dynamicRegistration`, so without this it never learns a dependency was
  // Installed. `relativePatternSupport` is what makes it register its Python search paths, which is
  // The only way an out-of-repo venv (conda, pyenv) is ever covered.
  expect(initializeParams).toMatchObject({
    capabilities: {
      workspace: {
        didChangeWatchedFiles: { dynamicRegistration: true, relativePatternSupport: true },
      },
    },
  });
});

test("performHandshake sends config notifications after initialized, in order", async () => {
  const notified: { method: string; params: unknown }[] = [];
  const connection: LspConnection = {
    changeDocument: () => Effect.void,
    clearPublished: () => Effect.void,
    closeDocument: () => Effect.void,
    closed: Effect.sync(() => false),
    endPublishWait: Effect.void,
    notify: (method, params) => Effect.sync(() => void notified.push({ method, params })),
    openDocument: () => Effect.void,
    published: Effect.sync(() => new Map<string, unknown[]>()),
    pullDiagnostics: () =>
      Effect.fail(
        new LspRequestError({ message: "unsupported", method: "textDocument/diagnostic" }),
      ),
    request: (method) => Effect.sync(() => (method === "initialize" ? { capabilities: {} } : null)),
    watchedBases: Stream.empty,
    watchedFilesChanged: () => Effect.void,
    whenProjectLoaded: Effect.void,
  };

  await Effect.runPromise(
    performHandshake(connection, "/repo", {
      notifications: [
        { method: "json/schemaAssociations", params: { "package.json": ["https://s/pkg.json"] } },
      ],
    }),
  );

  // `initialized` first, then the one-shot association notification.
  expect(notified).toEqual([
    { method: "initialized", params: {} },
    { method: "json/schemaAssociations", params: { "package.json": ["https://s/pkg.json"] } },
  ]);
});

test("rust-analyzer keeps watching its own files rather than depending on ours", () => {
  // Its `files.watcher` defaults to `client`, so advertising didChangeWatchedFiles would otherwise
  // Flip it off its own `notify` backend and onto stet's event stream. It watches correctly today.
  expect(handshakeConfigFor(registry["rust-analyzer"] ?? {}, "/repo")).toMatchObject({
    initializationOptions: { files: { watcher: "server" } },
  });
});

test("handshake yields an empty capability set when no providers are advertised", async () => {
  // An oxlint-shaped reply: it lints via push and advertises none of the code-intel providers.
  const connection: LspConnection = {
    changeDocument: () => Effect.void,
    clearPublished: () => Effect.void,
    closeDocument: () => Effect.void,
    closed: Effect.sync(() => false),
    endPublishWait: Effect.void,
    notify: () => Effect.void,
    openDocument: () => Effect.void,
    published: Effect.sync(() => new Map<string, unknown[]>()),
    pullDiagnostics: () =>
      Effect.fail(
        new LspRequestError({ message: "unsupported", method: "textDocument/diagnostic" }),
      ),
    request: () => Effect.succeed({ capabilities: {} }),
    watchedBases: Stream.empty,
    watchedFilesChanged: () => Effect.void,
    whenProjectLoaded: Effect.void,
  };

  const handle = await Effect.runPromise(performHandshake(connection, "/repo"));

  expect(handle.capabilities.has("definition")).toBe(false);
  expect(handle.capabilities.has("pullDiagnostics")).toBe(false);
  expect(handle.capabilities.size).toBe(0);
});

test("handshake treats a malformed provider value as unsupported", async () => {
  // Only `true` or an options object advertises support; a non-conformant `null`/`0` must not count.
  const connection: LspConnection = {
    changeDocument: () => Effect.void,
    clearPublished: () => Effect.void,
    closeDocument: () => Effect.void,
    closed: Effect.sync(() => false),
    endPublishWait: Effect.void,
    notify: () => Effect.void,
    openDocument: () => Effect.void,
    published: Effect.sync(() => new Map<string, unknown[]>()),
    pullDiagnostics: () =>
      Effect.fail(
        new LspRequestError({ message: "unsupported", method: "textDocument/diagnostic" }),
      ),
    request: () =>
      Effect.succeed({
        capabilities: {
          definitionProvider: null,
          implementationProvider: 0,
          referencesProvider: 0,
        },
      }),
    watchedBases: Stream.empty,
    watchedFilesChanged: () => Effect.void,
    whenProjectLoaded: Effect.void,
  };

  const handle = await Effect.runPromise(performHandshake(connection, "/repo"));

  expect(handle.capabilities.has("definition")).toBe(false);
  expect(handle.capabilities.has("implementation")).toBe(false);
  expect(handle.capabilities.has("references")).toBe(false);
});

test("handshake advertises pull diagnostics and refresh support, and parses diagnosticProvider", async () => {
  let initializeParams: unknown;
  // A rust-analyzer-shaped reply: it advertises diagnosticProvider, so the pull path activates.
  const connection: LspConnection = {
    changeDocument: () => Effect.void,
    clearPublished: () => Effect.void,
    closeDocument: () => Effect.void,
    closed: Effect.sync(() => false),
    endPublishWait: Effect.void,
    notify: () => Effect.void,
    openDocument: () => Effect.void,
    published: Effect.sync(() => new Map<string, unknown[]>()),
    pullDiagnostics: () =>
      Effect.fail(
        new LspRequestError({ message: "unsupported", method: "textDocument/diagnostic" }),
      ),
    request: (method, params) =>
      Effect.sync(() => {
        initializeParams = method === "initialize" ? params : initializeParams;
        return {
          capabilities: {
            diagnosticProvider: { interFileDependencies: true, workspaceDiagnostics: true },
          },
        };
      }),
    watchedBases: Stream.empty,
    watchedFilesChanged: () => Effect.void,
    whenProjectLoaded: Effect.void,
  };

  const handle = await Effect.runPromise(performHandshake(connection, "/repo"));

  expect(handle.capabilities.has("pullDiagnostics")).toBe(true);
  // Servers only answer `textDocument/diagnostic` (and only send refresh nudges) when the client
  // Declares the matching caps in `initialize`.
  expect(initializeParams).toMatchObject({
    capabilities: {
      textDocument: { diagnostic: { relatedDocumentSupport: true } },
      workspace: { diagnostics: { refreshSupport: true } },
    },
  });
});

test("handshakeConfigFor derives the handshake from data, substituting repo placeholders", async () => {
  const config = handshakeConfigFor(
    {
      initializationOptions: [
        { options: { configPath: null, run: "onType" }, workspaceUri: "{repoUri}" },
      ],
      settings: { configPath: null, root: "{repoRoot}", run: "onType" },
    },
    "/some/repo",
  );

  expect(config?.initializationOptions).toEqual([
    {
      options: { configPath: null, run: "onType" },
      workspaceUri: pathToFileURL("/some/repo").href,
    },
  ]);
  // Settings presence advertises the caps that invite the configuration pull.
  expect(config?.workspaceCapabilities).toEqual({ configuration: true, workspaceFolders: true });
  // Every requested configuration item gets one substituted copy of the settings.
  const answer = await Effect.runPromise(
    config?.onRequest?.("workspace/configuration", { items: [{}, {}] }) ?? Effect.succeed(null),
  );
  expect(answer).toEqual([
    { configPath: null, root: "/some/repo", run: "onType" },
    { configPath: null, root: "/some/repo", run: "onType" },
  ]);
  // Other server-to-client requests fall through to the transport's null default.
  const other = await Effect.runPromise(
    config?.onRequest?.("window/workDoneProgress/create", {}) ?? Effect.succeed("missing"),
  );
  expect(other).toBeNull();
});

test("handshakeConfigFor yields nothing for a server with no handshake needs", () => {
  expect(handshakeConfigFor({}, "/some/repo")).toBeUndefined();
});

test("the json server carries its schema associations as a post-initialized notification", () => {
  // The server never pulls configuration, so associations reach it only this way (the map form).
  const config = handshakeConfigFor(registry.json ?? {}, "/repo");
  expect(config?.notifications).toEqual([
    { method: "json/schemaAssociations", params: builtinSchemas },
  ]);
});

test("a local file schema resolves {repoUri} per repo in the association notification", () => {
  const config = handshakeConfigFor(
    { schemaAssociations: { "config.json": ["{repoUri}/schemas/config.json"] } },
    "/home/me/repo",
  );
  expect(config?.notifications).toEqual([
    {
      method: "json/schemaAssociations",
      params: { "config.json": ["file:///home/me/repo/schemas/config.json"] },
    },
  ]);
});

test("the yaml server enables SchemaStore through the configuration answer", async () => {
  const config = handshakeConfigFor(registry.yaml ?? {}, "/repo");
  expect(config?.workspaceCapabilities).toEqual({ configuration: true, workspaceFolders: true });
  const answer = await Effect.runPromise(
    config?.onRequest?.("workspace/configuration", { items: [{}, {}] }) ?? Effect.succeed(null),
  );
  expect(answer).toEqual([
    { schemaStore: { enable: true }, validate: true },
    { schemaStore: { enable: true }, validate: true },
  ]);
});

test("a handshake closure replaces the data-derived handshake entirely", () => {
  const config = handshakeConfigFor(
    {
      handshake: () => ({ initializationOptions: { fromClosure: true } }),
      initializationOptions: { fromData: true },
      settings: { fromData: true },
    },
    "/some/repo",
  );
  expect(config?.initializationOptions).toEqual({ fromClosure: true });
  expect(config?.workspaceCapabilities).toBeUndefined();
});

test("substitution never rescans text a placeholder inserted", () => {
  // A repo path containing a literal placeholder token is legal on disk; the substitution must
  // Insert it verbatim, not substitute inside its own output.
  const repoRoot = "/tmp/{repoUri}/repo";
  const config = handshakeConfigFor(
    { initializationOptions: { root: "{repoRoot}", uri: "{repoUri}" } },
    repoRoot,
  );
  expect(config?.initializationOptions).toEqual({
    root: repoRoot,
    uri: pathToFileURL(repoRoot).href,
  });
});

test("resolveServers adds a named user server with optimistic capability hints", () => {
  const { issues, servers } = resolveServers({
    elixir: {
      command: ["elixir-ls", "--stdio"],
      settings: { elixirLS: { dialyzerEnabled: false } },
    },
  });

  expect(issues).toEqual([]);
  expect(servers.elixir).toMatchObject({
    args: ["--stdio"],
    binary: "elixir-ls",
    settings: { elixirLS: { dialyzerEnabled: false } },
  });
  expect(servers.elixir?.provides).toContain("definition");
  expect(servers.elixir?.provision).toBeUndefined();
});

test("a user server can opt into Python virtualenv discovery", () => {
  const snapshot = snapshotServers();
  const repo = mkdtempSync(join(tmpdir(), "stet-user-python-server-"));
  const binary = join(repo, ".venv", "bin", "pylsp");
  const previousVirtualEnv = process.env.VIRTUAL_ENV;
  mkdirSync(join(repo, ".venv", "bin"), { recursive: true });
  writeFileSync(binary, "");
  delete process.env.VIRTUAL_ENV;

  try {
    const resolved = resolveServers({
      pylsp: { command: ["pylsp", "--stdio"], discovery: "python" },
    });
    expect(resolved.issues).toEqual([]);
    registerServers(resolved.servers);
    expect(resolveServerCommand("pylsp", repo)).toEqual([binary, "--stdio"]);
  } finally {
    restoreServers(snapshot);
    if (previousVirtualEnv === undefined) {
      delete process.env.VIRTUAL_ENV;
    } else {
      process.env.VIRTUAL_ENV = previousVirtualEnv;
    }
    rmSync(repo, { force: true, recursive: true });
  }
});

test("a command override drops trusted provisioning while other fields inherit", () => {
  const { issues, servers } = resolveServers({
    typescript: { command: ["/bin/ls", "--stdio"] },
  });

  expect(issues).toEqual([]);
  expect(servers.typescript?.binary).toBe("/bin/ls");
  expect(servers.typescript?.args).toEqual(["--stdio"]);
  expect(servers.typescript?.provides).toContain("hover");
  expect(servers.typescript?.provision).toBeUndefined();
});

test("a command override inherits Python discovery unless explicitly cleared", () => {
  const inherited = resolveServers({ ty: { command: ["custom-ty", "server"] } });
  const cleared = resolveServers({ ty: { discovery: false } });

  expect(inherited.issues).toEqual([]);
  expect(inherited.servers.ty?.discovery).toBe("python");
  expect(inherited.servers.ty?.provision).toBeUndefined();
  expect(cleared.issues).toEqual([]);
  expect(cleared.servers.ty?.discovery).toBeUndefined();
});

test("when false removes a built-in gate and false disables a server", () => {
  const { issues, servers } = resolveServers({ biome: { when: false }, yaml: false });

  expect(issues).toEqual([]);
  expect(servers.biome?.when).toBeUndefined();
  expect(servers.yaml).toBeUndefined();
});

test("an invalid override reports an issue and retains its built-in", () => {
  const { issues, servers } = resolveServers({
    biome: { command: [] },
    custom: { comand: ["custom-lsp"] },
    ty: { discovery: "ruby" },
  });

  expect(issues).toEqual([
    'server "biome": command must not be empty',
    'server "custom": unknown field "comand"',
    'server "ty": discovery must be "python" or false',
  ]);
  expect(servers.biome?.binary).toBe("biome");
  expect(servers.biome?.provision).toBeDefined();
  expect(servers.custom).toBeUndefined();
  expect(servers.ty?.discovery).toBe("python");
});

test("registered user server commands resolve as-is", () => {
  const snapshot = snapshotServers();
  try {
    const resolved = resolveServers({ probe: { command: ["/bin/ls", "--stdio"] } });
    expect(resolved.issues).toEqual([]);
    registerServers(resolved.servers);

    expect(resolveServerCommand("probe", "/some/repo")).toEqual(["/bin/ls", "--stdio"]);
  } finally {
    restoreServers(snapshot);
  }
});

test("server and repository identities do not collide when names contain spaces", () => {
  expect(serverRepoKey("lua server", "/repo")).not.toBe(serverRepoKey("lua", "server /repo"));
});

test("the server pool preserves configured names containing spaces", async () => {
  const snapshot = snapshotServers();
  const refreshes = await Effect.runPromise(Queue.unbounded<string>());
  const starts = await Effect.runPromise(Queue.unbounded<string>());
  const completions = await Effect.runPromise(Queue.unbounded<string>());
  let startedCommand: readonly string[] = [];
  const connection: LspConnection = {
    changeDocument: () => Effect.void,
    clearPublished: () => Effect.void,
    closeDocument: () => Effect.void,
    closed: Effect.succeed(false),
    endPublishWait: Effect.void,
    notify: () => Effect.void,
    openDocument: () => Effect.void,
    published: Effect.succeed(new Map<string, unknown[]>()),
    pullDiagnostics: () =>
      Effect.fail(
        new LspRequestError({ message: "unsupported", method: "textDocument/diagnostic" }),
      ),
    request: (method) => Effect.succeed(method === "initialize" ? { capabilities: {} } : null),
    watchedBases: Stream.empty,
    watchedFilesChanged: () => Effect.void,
    whenProjectLoaded: Effect.void,
  };
  const lspProcess = Layer.succeed(LspProcess)({
    refreshes,
    start: (command) =>
      Effect.sync(() => {
        startedCommand = command;
        return connection;
      }),
  });
  const provisioner = Layer.succeed(Provisioner)({
    completions,
    ensure: () => Effect.succeed({ kind: "disabled" }),
    ensurePlugin: () => Effect.die("unused"),
    starts,
  });
  const layer = LanguageServersLive.pipe(Layer.provide(Layer.mergeAll(lspProcess, provisioner)));

  try {
    const resolved = resolveServers({ "lua server": { command: ["/bin/ls", "--stdio"] } });
    expect(resolved.issues).toEqual([]);
    registerServers(resolved.servers);

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* acquireSpacedServer() {
          const servers = yield* LanguageServers;
          yield* servers.acquire("lua server", "/repo");
        }),
      ).pipe(Effect.provide(layer)),
    );

    expect(startedCommand).toEqual(["/bin/ls", "--stdio"]);
  } finally {
    restoreServers(snapshot);
  }
});

test("a Vue single-file component routes to the TS family and opens as vue", () => {
  expect(serversForPath("src/App.vue")).toEqual(["typescript", "oxlint", "biome"]);
  expect(lspLanguageId("src/App.vue")).toBe("vue");
});

test("a .vue file reaches tsserver only once its plugin is on hand", async () => {
  const bare = mkdtempSync(join(tmpdir(), "stet-vue-"));
  const local = mkdtempSync(join(tmpdir(), "stet-vue-"));
  const pnpm = mkdtempSync(join(tmpdir(), "stet-vue-"));
  const plain = mkdtempSync(join(tmpdir(), "stet-vue-"));
  writeFileSync(join(bare, "package.json"), JSON.stringify({ devDependencies: { vue: "^3.5.0" } }));
  writeFileSync(join(local, "package.json"), JSON.stringify({ dependencies: { vue: "^3.5.0" } }));
  mkdirSync(join(local, "node_modules", "@vue", "typescript-plugin"), { recursive: true });
  writeFileSync(join(local, "node_modules", "@vue", "typescript-plugin", "package.json"), "{}");
  // Pnpm's default hoist dir: a pnpm workspace whose root manifest never names vue.
  const hoist = join(pnpm, "node_modules", ".pnpm", "node_modules");
  mkdirSync(join(hoist, "vue"), { recursive: true });
  mkdirSync(join(hoist, "@vue", "typescript-plugin"), { recursive: true });
  writeFileSync(join(hoist, "@vue", "typescript-plugin", "package.json"), "{}");

  try {
    // A Vue repo that has the plugin (hoisted by npm, or into pnpm's hoist dir) routes `.vue` to
    // Tsserver, which loads the plugin.
    const routed = await Promise.all(
      [local, pnpm].map((repo) => Effect.runPromise(activeServersForPath("src/App.vue", repo))),
    );
    expect(routed).toEqual([
      ["typescript", "oxlint"],
      ["typescript", "oxlint"],
    ]);
    const loaded = await Promise.all(
      [local, pnpm].map((repo) =>
        Effect.runPromise(activeServerGates(repo)).then((gates) =>
          loadedPlugins(registry.typescript ?? {}, gates).map(({ plugin }) => plugin.name),
        ),
      ),
    );
    expect(loaded).toEqual([["@vue/typescript-plugin"], ["@vue/typescript-plugin"]]);

    // A Vue repo without it admits the plugin (so acquiring tsserver provisions it) but keeps
    // `.vue` off the plugin-less tsserver, which would refuse the open and read the file as clean;
    // Its `.ts` files are untouched.
    const gates = await Effect.runPromise(activeServerGates(bare));
    expect(activePlugins(registry.typescript ?? {}, gates).map((plugin) => plugin.name)).toEqual([
      "@vue/typescript-plugin",
    ]);
    expect(loadedPlugins(registry.typescript ?? {}, gates)).toEqual([]);
    expect(await Effect.runPromise(activeServersForPath("src/App.vue", bare))).toEqual(["oxlint"]);
    expect(await Effect.runPromise(activeServersForPath("src/a.ts", bare))).toEqual([
      "typescript",
      "oxlint",
    ]);

    // Outside a Vue repo nothing admits the plugin, so a stray `.vue` gets its linter only.
    const plainGates = await Effect.runPromise(activeServerGates(plain));
    expect(activePlugins(registry.typescript ?? {}, plainGates)).toEqual([]);
    expect(await Effect.runPromise(activeServersForPath("src/App.vue", plain))).toEqual(["oxlint"]);
  } finally {
    for (const repo of [bare, local, pnpm, plain]) {
      rmSync(repo, { force: true, recursive: true });
    }
  }
});

test("a plugin is located where the repo installed it, otherwise only once provisioned", () => {
  const repo = mkdtempSync(join(tmpdir(), "stet-vue-plugin-"));
  // A pin no cache on this machine can hold, so the cache tier answers nothing here.
  const plugin = {
    name: "@vue/typescript-plugin",
    packages: ["@vue/typescript-plugin@0.0.0-never"],
    when: "package.json",
  };
  try {
    expect(pluginLocation("typescript", plugin, repo)).toBeUndefined();
    // Under pnpm's hoist dir the probe is the dir holding that `node_modules`, where Node resolution
    // Starts, never the package dir itself.
    const hoist = join(repo, "node_modules", ".pnpm", "node_modules");
    mkdirSync(join(hoist, "@vue", "typescript-plugin"), { recursive: true });
    writeFileSync(join(hoist, "@vue", "typescript-plugin", "package.json"), "{}");
    expect(pluginLocation("typescript", plugin, repo)).toBe(join(repo, "node_modules", ".pnpm"));
    // Hoisted beside `@vue/language-server` by npm: the repo root.
    mkdirSync(join(repo, "node_modules", "@vue", "typescript-plugin"), { recursive: true });
    writeFileSync(join(repo, "node_modules", "@vue", "typescript-plugin", "package.json"), "{}");
    expect(pluginLocation("typescript", plugin, repo)).toBe(repo);
    // A discovery-only plugin (no channel) is the repo's or nobody's.
    expect(
      pluginLocation(
        "typescript",
        { name: "typescript-svelte-plugin", when: "package.json" },
        repo,
      ),
    ).toBeUndefined();
  } finally {
    rmSync(repo, { force: true, recursive: true });
  }
});

test("located plugins join tsserver's initialization options", () => {
  const plugins = [{ languages: ["vue"], location: "/repo", name: "@vue/typescript-plugin" }];
  // A server with no options of its own gets just the plugins key.
  expect(handshakeConfigFor({}, "/repo", plugins)).toEqual({ initializationOptions: { plugins } });
  // One with options keeps them, substituted, beside the plugins.
  expect(
    handshakeConfigFor(
      { initializationOptions: { preferences: { quotePreference: "single" }, root: "{repoRoot}" } },
      "/repo",
      plugins,
    ),
  ).toEqual({
    initializationOptions: { plugins, preferences: { quotePreference: "single" }, root: "/repo" },
  });
  // A user-configured plugin keeps loading beside the registry's rather than being replaced.
  const styled = { location: "/x", name: "typescript-styled-plugin" };
  expect(
    handshakeConfigFor({ initializationOptions: { plugins: [styled] } }, "/repo", plugins),
  ).toEqual({ initializationOptions: { plugins: [styled, ...plugins] } });
  // No located plugin leaves the typescript handshake exactly as it was.
  expect(handshakeConfigFor(registry.typescript ?? {}, "/repo")).toBeUndefined();
});

test("the pool spawns tsserver with the plugins on hand and rebuilds it once the set moves", async () => {
  const vueRepo = mkdtempSync(join(tmpdir(), "stet-vue-pool-"));
  const bareVueRepo = mkdtempSync(join(tmpdir(), "stet-vue-pool-"));
  const plainRepo = mkdtempSync(join(tmpdir(), "stet-vue-pool-"));
  // Stet's cache for the test, so a plugin planted there is found by the real cache tier.
  const cache = mkdtempSync(join(tmpdir(), "stet-vue-cache-"));
  const previousCache = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = cache;
  for (const repo of [vueRepo, bareVueRepo]) {
    writeFileSync(join(repo, "package.json"), JSON.stringify({ dependencies: { vue: "3.5.0" } }));
  }
  // A repo-local typescript-language-server, so discovery resolves it and nothing is spawned for
  // Real (the LspProcess below is a fake peer).
  for (const repo of [vueRepo, bareVueRepo, plainRepo]) {
    mkdirSync(join(repo, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(repo, "node_modules", ".bin", "typescript-language-server"), "");
  }
  mkdirSync(join(vueRepo, "node_modules", "@vue", "typescript-plugin"), { recursive: true });
  writeFileSync(join(vueRepo, "node_modules", "@vue", "typescript-plugin", "package.json"), "{}");

  const initializations: { repoRoot: string; params: unknown }[] = [];
  const ensured: { server: string; plugin: unknown }[] = [];
  const refreshes = await Effect.runPromise(Queue.unbounded<string>());
  const starts = await Effect.runPromise(Queue.unbounded<string>());
  const completions = await Effect.runPromise(Queue.unbounded<string>());
  const lspProcess = Layer.succeed(LspProcess)({
    refreshes,
    start: (_command, repoRoot) =>
      Effect.succeed<LspConnection>({
        changeDocument: () => Effect.void,
        clearPublished: () => Effect.void,
        closeDocument: () => Effect.void,
        closed: Effect.succeed(false),
        endPublishWait: Effect.void,
        notify: () => Effect.void,
        openDocument: () => Effect.void,
        published: Effect.succeed(new Map<string, unknown[]>()),
        pullDiagnostics: () =>
          Effect.fail(
            new LspRequestError({ message: "unsupported", method: "textDocument/diagnostic" }),
          ),
        request: (method, params) =>
          Effect.sync(() => {
            if (method === "initialize") {
              initializations.push({ params, repoRoot });
            }
            return method === "initialize" ? { capabilities: {} } : null;
          }),
        watchedBases: Stream.empty,
        watchedFilesChanged: () => Effect.void,
        whenProjectLoaded: Effect.void,
      }),
  });
  const provisioner = Layer.succeed(Provisioner)({
    completions,
    ensure: () => Effect.die("the server is repo-local"),
    ensurePlugin: (server, plugin) =>
      Effect.sync(() => {
        ensured.push({ plugin, server });
        return { kind: "installing" as const };
      }),
    starts,
  });
  const layer = LanguageServersLive.pipe(Layer.provide(Layer.mergeAll(lspProcess, provisioner)));
  const withPlugins = (location: string) =>
    expect.objectContaining({
      initializationOptions: {
        plugins: [{ languages: ["vue"], location, name: "@vue/typescript-plugin" }],
      },
    });
  const pinned = { name: "@vue/typescript-plugin", packages: ["@vue/typescript-plugin@3.3.12"] };
  const landed = join(
    cache,
    "stet",
    "lsp",
    "typescript",
    "plugins",
    provisionKey({ kind: "npm", packages: pinned.packages }),
  );

  try {
    // One pool for the whole scenario, since what is under test is the pooled process surviving
    // Or not across acquires; each acquire releases its own reference.
    await Effect.runPromise(
      Effect.gen(function* scenario() {
        const servers = yield* LanguageServers;
        const acquire = (repo: string) =>
          Effect.scoped(servers.acquire("typescript", repo)).pipe(Effect.exit);

        // The repo installed the plugin itself: tsserver is told to probe the repo for it.
        yield* acquire(vueRepo);
        expect(initializations).toEqual([{ params: withPlugins(vueRepo), repoRoot: vueRepo }]);
        expect(ensured).toEqual([]);

        // A Vue repo without it: the run's provisioning pass sends the plugin to download (acquire
        // Itself never does, since a run over `.vue` files alone acquires no tsserver), and tsserver
        // Spawns meanwhile without it, so the repo's `.ts` files never wait on a `.vue` plugin.
        yield* servers.provisionPlugins(bareVueRepo);
        expect(ensured).toEqual([{ plugin: pinned, server: "typescript" }]);
        expect(Exit.isSuccess(yield* acquire(bareVueRepo))).toBe(true);
        expect(initializations[1]).toEqual({
          params: expect.objectContaining({ initializationOptions: undefined }),
          repoRoot: bareVueRepo,
        });
        // Still installing: the pooled process stands, and the next run's pass asks provisioning
        // Again (the idempotent status read) rather than spawning a second process.
        yield* servers.provisionPlugins(bareVueRepo);
        yield* acquire(bareVueRepo);
        expect(initializations).toHaveLength(2);
        expect(ensured).toHaveLength(2);

        // The install lands in the cache (the marker is what says so): the pooled process is
        // Stale, the next acquire rebuilds it with the plugin, and nothing asks the provisioner.
        mkdirSync(landed, { recursive: true });
        writeFileSync(join(landed, ".installed"), "");
        yield* servers.provisionPlugins(bareVueRepo);
        expect(Exit.isSuccess(yield* acquire(bareVueRepo))).toBe(true);
        expect(initializations[2]).toEqual({ params: withPlugins(landed), repoRoot: bareVueRepo });
        expect(ensured).toHaveLength(2);
        // And that process is kept while the set holds.
        yield* acquire(bareVueRepo);
        expect(initializations).toHaveLength(3);

        // The repo then installs the plugin itself: same name, different probe dir, so the process
        // Spawned against the cache copy is stale too and is rebuilt against the repo's.
        mkdirSync(join(bareVueRepo, "node_modules", "@vue", "typescript-plugin"), {
          recursive: true,
        });
        writeFileSync(
          join(bareVueRepo, "node_modules", "@vue", "typescript-plugin", "package.json"),
          "{}",
        );
        expect(Exit.isSuccess(yield* acquire(bareVueRepo))).toBe(true);
        expect(initializations[3]).toEqual({
          params: withPlugins(bareVueRepo),
          repoRoot: bareVueRepo,
        });

        // A repo that is not a Vue repo loads no plugin and keeps the bare typescript handshake.
        yield* servers.provisionPlugins(plainRepo);
        yield* acquire(plainRepo);
        expect(initializations[4]).toEqual({
          params: expect.objectContaining({ initializationOptions: undefined }),
          repoRoot: plainRepo,
        });
        expect(ensured).toHaveLength(2);
      }).pipe(Effect.provide(layer)),
    );
  } finally {
    if (previousCache === undefined) {
      delete process.env.XDG_CACHE_HOME;
    } else {
      process.env.XDG_CACHE_HOME = previousCache;
    }
    for (const dir of [vueRepo, bareVueRepo, plainRepo, cache]) {
      rmSync(dir, { force: true, recursive: true });
    }
  }
});
