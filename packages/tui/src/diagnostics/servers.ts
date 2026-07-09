/**
 * Discovers and brings up language servers, pooled one per (language, repo root). Discovery is the
 * hybrid path: a repo-local binary wins over one on PATH (reusing the checker's `resolveBinary`).
 * The pool keeps a server warm across the many poll-driven pulls and releases it once the last
 * reference drops, so a worktree switch transparently swaps to a fresh server for the new root.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { Context, Data, Effect, Layer, RcMap } from "effect";
import type { Scope } from "effect";

import { resolveBinary } from "./checker";
import { LspProcess } from "./lsp-process";
import type { LspSpawnError } from "./lsp-process";
import { cachedBinaryPath, Provisioner } from "./provision";
import type { ProvisionSpec } from "./provision";
import { LspRequestError } from "./transport";
import type { LspConnection } from "./transport";

export class ServerUnavailable extends Data.TaggedError("ServerUnavailable")<{
  readonly language: string;
  readonly message: string;
}> {}

/** The language's server is still downloading; its files render as pending, not unavailable. */
export class ServerInstalling extends Data.TaggedError("ServerInstalling")<{
  readonly language: string;
}> {}

/**
 * The `initialize` shape and server-to-client request answers a server needs beyond the read-only
 * baseline, parameterized by repo root. typescript needs none of this; oxlint advertises
 * `workspace.configuration` and answers `workspace/configuration` with its lint options, or it
 * stays silent.
 */
interface HandshakeConfig {
  readonly workspaceCapabilities?: Record<string, unknown>;
  readonly initializationOptions?: unknown;
  readonly onRequest?: (method: string, params: unknown) => Effect.Effect<unknown>;
}

/** The read-only LSP intents stet uses, keyed off each server's advertised `*Provider`. */
export type Capability =
  | "definition"
  | "references"
  | "hover"
  | "documentSymbol"
  | "callHierarchy"
  | "implementation"
  | "pullDiagnostics";

interface ServerSpec {
  readonly binary: string;
  readonly args: readonly string[];
  /**
   * The intents this server can answer, declared statically so intel skips a non-provider without
   * acquiring it. A pre-acquire filter only; the handshake-advertised set on `ServerHandle` stays
   * the authoritative gate, so this must not under-declare what the server actually provides.
   */
  readonly provides: readonly Capability[];
  /** Npm packages stet installs into its cache when the server is found neither in repo nor PATH. */
  readonly provision?: { readonly packages: readonly string[] };
  /** Per-server handshake extras (caps, initializationOptions, server-request answers). */
  readonly handshake?: (repoRoot: string) => HandshakeConfig;
  /**
   * When set, the server runs only in repos this predicate accepts. oxlint/typescript run in every
   * JS/TS repo, but a competing linter like Biome should activate only where the repo opted into it
   * (a `biome.json`), the way an editor's Biome extension does, so it neither downloads into repos
   * that don't use it nor duplicates oxlint's findings.
   */
  readonly detect?: (repoRoot: string) => boolean;
}

// Adding a language is one `languages` entry (its file types and server order) plus a `registry`
// Entry per new server; the transport, pool, and handshake are language-agnostic. A language lists
// Every server that analyzes it (typescript type-checks the JS/TS family, oxlint lints the same
// Files) and the per-file results merge. A server with a `detect` gate runs only where its
// Predicate accepts the repo (Biome needs a biome config).
//
// `provision.packages` pin exact versions, never a bare name that resolves `@latest`: the tier-3
// Download is otherwise nondeterministic (whatever the registry serves that day) and would pull a
// Broken or compromised upstream release automatically, a weaker bar than stet's own pinned
// Distribution. Pinning also lets npm verify the tarball against its immutable published version.
// Bumping a pin is an explicit reviewable edit; the cache is keyed by the pinned set (`provisionKey`)
// So a bump re-provisions. The oxlint/typescript pins deliberately track this repo's own devDeps but
// Are independent (stet's build toolchain vs. the LSP server it downloads into arbitrary repos).
export const registry: Record<string, ServerSpec> = {
  biome: {
    args: ["lsp-proxy"],
    binary: "biome",
    // Read off disk; `detect` guarantees a biome config exists, so Biome resolves it on its own and
    // The transport's null default answers its `workspace/configuration` pull. No handshake needed.
    detect: (repoRoot) =>
      existsSync(join(repoRoot, "biome.json")) || existsSync(join(repoRoot, "biome.jsonc")),
    provides: [],
    provision: { packages: ["@biomejs/biome@2.5.2"] },
  },
  json: {
    // Always-on (no `detect`) so JSON gets schema validation in every repo. It overlaps Biome's
    // Json coverage where a biome config exists, but the two are complementary: Biome lints, this
    // Validates against schemas (package.json/tsconfig/SchemaStore); only raw syntax errors double
    // Up, and the per-file merge unions them.
    args: ["--stdio"],
    binary: "vscode-json-language-server",
    provides: [],
    provision: { packages: ["vscode-langservers-extracted@4.10.0"] },
  },
  oxlint: {
    args: ["--lsp"],
    binary: "oxlint",
    handshake: (repoRoot) => {
      // Oxlint validates only once it has workspace options; passing them inline (and answering
      // Its `workspace/configuration` pull defensively) makes it publish on didOpen. `run: onType`
      // Lints the open buffer; `configPath: null` finds `.oxlintrc.json` or uses defaults.
      const workspaceUri = pathToFileURL(repoRoot).href;
      const options = { configPath: null, run: "onType" };
      return {
        initializationOptions: [{ options, workspaceUri }],
        onRequest: (method, params) =>
          Effect.succeed(
            method === "workspace/configuration"
              ? configurationItems(params).map(() => options)
              : null,
          ),
        workspaceCapabilities: { configuration: true, workspaceFolders: true },
      };
    },
    provides: [],
    provision: { packages: ["oxlint@1.72.0"] },
  },
  typescript: {
    args: ["--stdio"],
    binary: "typescript-language-server",
    provides: [
      "definition",
      "references",
      "hover",
      "documentSymbol",
      "callHierarchy",
      "implementation",
    ],
    provision: { packages: ["typescript-language-server@5.3.0", "typescript@6.0.3"] },
  },
  yaml: {
    args: ["--stdio"],
    binary: "yaml-language-server",
    provides: [],
    provision: { packages: ["yaml-language-server@1.23.0"] },
  },
};

function configurationItems(params: unknown): unknown[] {
  return isObject(params) && Array.isArray(params.items) ? params.items : [];
}

/**
 * A language: the file types it owns and the ordered servers that analyze them. Each extension or
 * exact filename maps to the LSP `languageId` sent on `didOpen` (finer-grained than the language
 * key: `tsx` opens as `typescriptreact`), so a routable file type and its `languageId` cannot drift
 * apart. `servers` names `registry` keys, primary server first, then linters.
 */
interface Language {
  /** Extension (no dot) -> LSP `languageId`. */
  readonly extensions: Record<string, string>;
  /** Exact basename -> LSP `languageId`; wins over the extension match. */
  readonly filenames?: Record<string, string>;
  readonly servers: readonly string[];
}

// No built-in declares `filenames` yet; it routes extensionless types (Dockerfile, Makefile) the
// Day a server for one lands, resolving exact-name-then-extension the way the icon and highlighter
// Lookups already do.
const builtinLanguages: Record<string, Language> = {
  css: { extensions: { css: "css" }, servers: ["biome"] },
  graphql: { extensions: { graphql: "graphql" }, servers: ["biome"] },
  json: { extensions: { json: "json", jsonc: "jsonc" }, servers: ["json", "biome"] },
  typescript: {
    extensions: {
      cjs: "javascript",
      cts: "typescript",
      js: "javascript",
      jsx: "javascriptreact",
      mjs: "javascript",
      mts: "typescript",
      ts: "typescript",
      tsx: "typescriptreact",
    },
    servers: ["typescript", "oxlint", "biome"],
  },
  yaml: { extensions: { yaml: "yaml", yml: "yaml" }, servers: ["yaml"] },
};

const languages = new Map(Object.entries(builtinLanguages));

// Test-only: the language table is a process-global map, so a test that registers a language would
// Leak it into later tests. Snapshot before and restore after to isolate.
export function snapshotLanguages() {
  return new Map(languages);
}

export function restoreLanguages(snapshot: ReturnType<typeof snapshotLanguages>) {
  languages.clear();
  for (const [name, language] of snapshot) {
    languages.set(name, language);
  }
}

/** Merge languages into the table; the config layer registers user languages through this. */
export function registerLanguages(entries: Record<string, Language>) {
  for (const [name, language] of Object.entries(entries)) {
    languages.set(name, language);
  }
}

// Exact filename beats extension; the extension comes from the basename so a dotted directory
// Never reads as one.
function fileType(path: string) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  for (const language of languages.values()) {
    const languageId = language.filenames?.[base];
    if (languageId !== undefined) {
      return { language, languageId };
    }
  }
  const dot = base.lastIndexOf(".");
  if (dot === -1) {
    return undefined;
  }
  const extension = base.slice(dot + 1);
  for (const language of languages.values()) {
    const languageId = language.extensions[extension];
    if (languageId !== undefined) {
      return { language, languageId };
    }
  }
  return undefined;
}

/** The owning language's servers for this file's type, in declared order, unknown keys dropped. */
export function serversForPath(path: string): string[] {
  const type = fileType(path);
  return type === undefined
    ? []
    : type.language.servers.filter((server) => registry[server] !== undefined);
}

/**
 * The registered servers whose repo gate (if any) accepts `repoRoot`. Evaluate once per run and
 * reuse across files: a gate may stat the filesystem (Biome's `detect`), so re-checking it per file
 * per snapshot emission would re-stat the same config repeatedly for an invariant result.
 */
export function activeLanguages(repoRoot: string): Set<string> {
  return new Set(
    Object.keys(registry).filter((server) => registry[server]?.detect?.(repoRoot) ?? true),
  );
}

/** The file's language servers whose repo gate (if any) accepts `repoRoot`. */
export function activeServersForPath(path: string, repoRoot: string): string[] {
  const active = activeLanguages(repoRoot);
  return serversForPath(path).filter((server) => active.has(server));
}

/** Servers for this path that statically declare they can answer `capability`, in declared order. */
export function serversProviding(path: string, capability: Capability): string[] {
  return serversForPath(path).filter((server) => registry[server]?.provides.includes(capability));
}

const intelCapabilities = new Set<Capability>([
  "definition",
  "references",
  "hover",
  "documentSymbol",
  "callHierarchy",
  "implementation",
]);

/**
 * The first active server for this file that statically declares any code-intel capability, or
 * undefined when none does. Drives the warm-hold: it decides whether (and which server) to keep
 * warm for the viewed file's repo so the first intel pull finds an already-loaded project rather
 * than paying a cold spawn plus project load.
 */
export function intelLanguage(path: string, repoRoot: string): string | undefined {
  return activeServersForPath(path, repoRoot).find((server) =>
    (registry[server]?.provides ?? []).some((capability) => intelCapabilities.has(capability)),
  );
}

/**
 * The LSP `languageId` for `didOpen`, from the owning language's file-type map; `plaintext` when no
 * language claims the file (a server never analyzes a `plaintext` document).
 */
export function lspLanguageId(path: string): string {
  return fileType(path)?.languageId ?? "plaintext";
}

// Discovery tiers: a repo-local binary or one on PATH wins; otherwise a server stet has already
// Provisioned into its cache. A not-yet-provisioned server returns undefined (acquire then installs).
export function resolveServerCommand(language: string, repoRoot: string): string[] | undefined {
  const spec = registry[language];
  if (spec === undefined) {
    return undefined;
  }
  const repoOrPath = resolveBinary(repoRoot, spec.binary);
  if (repoOrPath !== undefined) {
    return [repoOrPath, ...spec.args];
  }
  if (spec.provision !== undefined) {
    const cached = cachedBinaryPath(language, spec.binary, spec.provision.packages);
    if (existsSync(cached)) {
      return [cached, ...spec.args];
    }
  }
  return undefined;
}

function provisionSpecFor(language: string): ProvisionSpec | undefined {
  const spec = registry[language];
  if (spec?.provision === undefined) {
    return undefined;
  }
  return { args: spec.args, binary: spec.binary, packages: spec.provision.packages };
}

export interface ServerHandle {
  readonly connection: LspConnection;
  /** Which read-only intents this server advertised; drives data-driven server selection. */
  readonly capabilities: ReadonlySet<Capability>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// LSP advertises a provider as `true` or an options object when supported, `undefined`/`false` when not.
const capabilityProviders = [
  ["definition", "definitionProvider"],
  ["references", "referencesProvider"],
  ["hover", "hoverProvider"],
  ["documentSymbol", "documentSymbolProvider"],
  ["callHierarchy", "callHierarchyProvider"],
  ["implementation", "implementationProvider"],
  ["pullDiagnostics", "diagnosticProvider"],
] as const satisfies readonly (readonly [Capability, string])[];

function parseCapabilities(initializeResult: unknown): Set<Capability> {
  const capabilities = isObject(initializeResult) ? initializeResult.capabilities : undefined;
  if (!isObject(capabilities)) {
    return new Set();
  }
  return new Set(
    capabilityProviders
      .filter(([, provider]) => {
        const advertised = capabilities[provider];
        return advertised === true || isObject(advertised);
      })
      .map(([capability]) => capability),
  );
}

/**
 * The LSP lifecycle handshake for a read-only client: `initialize` advertising only read-only
 * capabilities (diagnostics plus the code-intel pulls; no edit/format/rename), then `initialized`.
 * The server's advertised `*Provider`s decide which intents `capabilities` carries.
 */
export function performHandshake(
  connection: LspConnection,
  repoRoot: string,
  config?: HandshakeConfig,
) {
  return Effect.gen(function* handshake() {
    const result = yield* connection
      .request("initialize", {
        capabilities: {
          // Push diagnostics require advertising publishDiagnostics + synchronization, or servers
          // (E.g. typescript-language-server) stay silent. The definition/references/hover/symbol
          // Caps are the read-only code-intel pulls, all `textDocument/*` requests. No
          // Edit/format/rename: read-only. linkSupport lets definition reply with `LocationLink`s,
          // Which carry the symbol's name range. hierarchicalDocumentSymbolSupport is what makes a
          // Server return the nested `DocumentSymbol[]` (with `children`); without it it downgrades
          // To a flat `SymbolInformation[]` and the outline loses all nesting. A server only
          // Advertises `callHierarchyProvider` when the client advertises the matching client cap,
          // So it is declared here or the two-step prepare/resolve pull stays unavailable.
          textDocument: {
            callHierarchy: { dynamicRegistration: false },
            definition: { dynamicRegistration: false, linkSupport: true },
            documentSymbol: { dynamicRegistration: false, hierarchicalDocumentSymbolSupport: true },
            hover: { dynamicRegistration: false },
            implementation: { dynamicRegistration: false, linkSupport: true },
            publishDiagnostics: { relatedInformation: true, versionSupport: false },
            references: { dynamicRegistration: false },
            synchronization: { didSave: false, dynamicRegistration: false },
          },
          // A server that pulls its settings (oxlint) needs the workspace caps advertised here.
          ...(config?.workspaceCapabilities === undefined
            ? {}
            : { workspace: config.workspaceCapabilities }),
          // Opt into server-driven progress so tsserver reports project-load begin/end; intel pulls
          // Gate on the "end" (see `whenProjectLoaded`), and without this it sends no progress at all.
          window: { workDoneProgress: true },
        },
        initializationOptions: config?.initializationOptions,
        processId: process.pid,
        rootUri: pathToFileURL(repoRoot).href,
        workspaceFolders: [{ name: "root", uri: pathToFileURL(repoRoot).href }],
      })
      .pipe(
        // A server that spawns but never answers initialize must not wedge the run.
        Effect.timeout("10 seconds"),
        Effect.catchTag("TimeoutError", () =>
          Effect.fail(
            new LspRequestError({ message: "initialize timed out", method: "initialize" }),
          ),
        ),
      );
    yield* connection.notify("initialized", {});
    return {
      capabilities: parseCapabilities(result),
      connection,
    } satisfies ServerHandle;
  });
}

function connectServer(command: readonly string[], repoRoot: string, config?: HandshakeConfig) {
  return Effect.gen(function* connect() {
    const lsp = yield* LspProcess;
    const connection = yield* lsp.start(command, repoRoot, config?.onRequest);
    const handle = yield* performHandshake(connection, repoRoot, config);
    // Best-effort graceful teardown before the child is killed on scope close.
    yield* Effect.addFinalizer(() =>
      connection
        .request("shutdown")
        .pipe(Effect.andThen(connection.notify("exit")), Effect.timeout("1 second"), Effect.ignore),
    );
    return handle;
  });
}

// The pool key is "<language> <repoRoot>"; the language never contains a space, so the first space
// Is always the separator even when the repo path does. The explicit return type unifies the
// Ternary's two distinct Effect types into the one shape RcMap's lookup expects.
function lookupServer(
  key: string,
): Effect.Effect<
  ServerHandle,
  ServerUnavailable | LspSpawnError | LspRequestError,
  LspProcess | Scope.Scope
> {
  const separator = key.indexOf(" ");
  const language = key.slice(0, separator);
  const repoRoot = key.slice(separator + 1);
  const command = resolveServerCommand(language, repoRoot);
  if (command === undefined) {
    return Effect.fail(
      new ServerUnavailable({ language, message: `no language server for ${language}` }),
    );
  }
  return connectServer(command, repoRoot, registry[language]?.handshake?.(repoRoot));
}

export class LanguageServers extends Context.Service<
  LanguageServers,
  {
    readonly acquire: (
      language: string,
      repoRoot: string,
    ) => Effect.Effect<
      ServerHandle,
      ServerUnavailable | ServerInstalling | LspSpawnError | LspRequestError,
      Scope.Scope
    >;
  }
>()("stet/LanguageServers") {}

type AcquireError = ServerUnavailable | ServerInstalling | LspSpawnError | LspRequestError;

export const LanguageServersLive = Layer.effect(
  LanguageServers,
  Effect.gen(function* languageServers() {
    const provisioner = yield* Provisioner;
    const pool = yield* RcMap.make({ idleTimeToLive: "30 seconds", lookup: lookupServer });

    // Connect through the warm pool; if the pooled server died (its stdout closed), evict it and
    // Bring up a fresh one, so a crash mid-session recovers on the next run.
    const fromPool = (language: string, repoRoot: string) => {
      const key = `${language} ${repoRoot}`;
      return RcMap.get(pool, key).pipe(
        Effect.flatMap((handle) =>
          handle.connection.closed.pipe(
            Effect.flatMap((isClosed) =>
              isClosed
                ? RcMap.invalidate(pool, key).pipe(Effect.andThen(RcMap.get(pool, key)))
                : Effect.succeed(handle),
            ),
          ),
        ),
      );
    };

    const acquire = (
      language: string,
      repoRoot: string,
    ): Effect.Effect<ServerHandle, AcquireError, Scope.Scope> =>
      Effect.suspend(() => {
        // A server already in the repo, on PATH, or provisioned into the cache: use it.
        if (resolveServerCommand(language, repoRoot) !== undefined) {
          return fromPool(language, repoRoot);
        }
        // Otherwise provision it (third tier); files stay pending until the download lands.
        const spec = provisionSpecFor(language);
        if (spec === undefined) {
          return Effect.fail(
            new ServerUnavailable({ language, message: `no language server for ${language}` }),
          );
        }
        return provisioner.ensure(language, spec).pipe(
          Effect.flatMap((state): Effect.Effect<ServerHandle, AcquireError, Scope.Scope> => {
            if (state.kind === "ready") {
              return fromPool(language, repoRoot);
            }
            if (state.kind === "installing") {
              return Effect.fail(new ServerInstalling({ language }));
            }
            if (state.kind === "failed") {
              return Effect.fail(new ServerUnavailable({ language, message: state.message }));
            }
            // Disabled: a server was needed but auto-download is off.
            return Effect.fail(
              new ServerUnavailable({
                language,
                message: `${language} server not found; auto-download is disabled`,
              }),
            );
          }),
        );
      });

    return { acquire };
  }),
);
