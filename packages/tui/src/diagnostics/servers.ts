/**
 * Discovers and brings up language servers, pooled one per (language, repo root). Discovery is the
 * hybrid path: a repo-local binary wins over one on PATH (reusing the checker's `resolveBinary`).
 * The pool keeps a server warm across the many poll-driven pulls and releases it once the last
 * reference drops, so a worktree switch transparently swaps to a fresh server for the new root.
 */
import { existsSync, watch } from "node:fs";
import { pathToFileURL } from "node:url";

import { Context, Data, Effect, Layer, Queue, RcMap, Stream } from "effect";
import type { Scope } from "effect";

import type { ServerCandidate, ServerEntry } from "@/file-support/model";
import { fileSupportForPath, registeredLanguageProfiles } from "@/file-support/registry";

import { resolveBinary } from "./checker";
import type { BinaryDiscovery } from "./checker";
import { LspProcess } from "./lsp-process";
import type { LspSpawnError } from "./lsp-process";
import { cachedBinaryPath, Provisioner } from "./provision";
import type { ProvisionChannel, ProvisionSpec } from "./provision";
import { builtinSchemas } from "./schemas";
import { LspRequestError } from "./transport";
import type { LspConnection } from "./transport";
import type { WatchedPathChange } from "./watched-files";
import { evaluateWhen, makeManifestCache, parseWhen } from "./when";
import type { When } from "./when";

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
  /**
   * Notifications to send once, right after `initialized`. The JSON server takes its schema
   * associations only this way: it never pulls `workspace/configuration`, so the `settings` channel
   * cannot reach it.
   */
  readonly notifications?: readonly { readonly method: string; readonly params: unknown }[];
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

export interface ServerSpec {
  readonly binary: string;
  readonly args: readonly string[];
  /** Optional repository-environment strategy used before the standard local/PATH lookup. */
  readonly discovery?: BinaryDiscovery;
  /**
   * The intents this server can answer, declared statically so intel skips a non-provider without
   * acquiring it. A pre-acquire filter only; the handshake-advertised set on `ServerHandle` stays
   * the authoritative gate, so this must not under-declare what the server actually provides.
   */
  readonly provides: readonly Capability[];
  /** How stet installs the server into its cache when it is found neither in repo nor on PATH. */
  readonly provision?: ProvisionChannel;
  /**
   * Plain JSON for `initialize`'s `initializationOptions`; `{repoRoot}`/`{repoUri}` in any string
   * leaf substitute per repo. Data, not code, so a config layer can express it verbatim.
   */
  readonly initializationOptions?: unknown;
  /**
   * The `workspace/configuration` answer, one copy per requested item, same substitution. Its
   * presence advertises the `workspace.configuration`/`workspaceFolders` client caps, which is what
   * makes a settings-pulling server (oxlint) publish at all.
   */
  readonly settings?: unknown;
  /**
   * File-match pattern -> schema URI(s), sent to the JSON server as a post-`initialized`
   * `json/schemaAssociations` notification (the map form; the array form the server also parses
   * silently registers no schema). `{repoRoot}` in a leaf substitutes per repo for a local
   * `file://` schema. The user `schemas` config merges over the built-in map before registration.
   */
  readonly schemaAssociations?: Record<string, readonly string[]>;
  /**
   * Escape hatch for handshake shapes the `initializationOptions`/`settings` data can't express (a
   * server whose `workspace/configuration` answer depends on the request's items). When set it
   * replaces the data-derived handshake entirely. No built-in uses it today.
   */
  readonly handshake?: (repoRoot: string) => HandshakeConfig;
  readonly when?: When;
}

// Server commands stay independent from file associations and language profiles. When a built-in
// Changes here, update docs/content/docs/reference/languages.mdx to match. A profile may list every
// Server that analyzes it, or choose the first eligible candidate; the per-file results merge.
// Declarative `when` data gates a server by repository without running repo-owned code.
//
// `provision.packages` pin exact versions, never a bare name that resolves `@latest`: the tier-3
// Download is otherwise nondeterministic (whatever the registry serves that day) and would pull a
// Broken or compromised upstream release automatically, a weaker bar than stet's own pinned
// Distribution. Pinning also lets npm verify the tarball against its immutable published version.
// Bumping a pin is an explicit reviewable edit; the cache is keyed by the pinned set (`provisionKey`)
// So a bump re-provisions. The oxlint/typescript pins deliberately track this repo's own devDeps but
// Are independent (stet's build toolchain vs. the LSP server it downloads into arbitrary repos).
const builtinRegistry: Record<string, ServerSpec> = {
  // The basedpyright fork reinstates the read-only providers pyright gates behind its VS Code
  // Extension; the npm package ships `basedpyright-langserver`. It type-checks Python and answers
  // The code-intel pulls, the typescript-language-server analog. Zero-config: it reads
  // Pyrightconfig/pyproject on its own and pulls `python.*` settings the transport's null default
  // Answers, so it needs no handshake extras. It is the ungated fallback in Python's `firstOf`
  // Group, running only where ty's gate does not claim the repository.
  "basedpyright": {
    args: ["--stdio"],
    binary: "basedpyright-langserver",
    discovery: "python",
    // Verified against its `initialize` result: it advertises every intel provider stet uses,
    // Implementation included.
    provides: [
      "definition",
      "references",
      "hover",
      "documentSymbol",
      "callHierarchy",
      "implementation",
    ],
    provision: { kind: "npm", packages: ["basedpyright@1.39.9"] },
  },
  "biome": {
    args: ["lsp-proxy"],
    binary: "biome",
    provides: [],
    provision: { kind: "npm", packages: ["@biomejs/biome@2.5.2"] },
    when: ["biome.json", "biome.jsonc"],
  },
  // Go's official language server (bare `gopls` serves LSP over stdio). It answers every intel pull
  // And pushes its type/vet diagnostics. Discovery-only: gopls ships no prebuilt release binaries and
  // Stet never builds from source, so it has no `provision` channel and is used only when found
  // Repo-local or on PATH (`go install golang.org/x/tools/gopls@latest`), never downloaded.
  "gopls": {
    args: [],
    binary: "gopls",
    provides: [
      "definition",
      "references",
      "hover",
      "documentSymbol",
      "callHierarchy",
      "implementation",
    ],
  },
  "json": {
    // Always-on (no `when`) so JSON gets schema validation in every repo. It overlaps Biome's
    // Json coverage where a biome config exists, but the two are complementary: Biome lints, this
    // Validates against the associated schemas; only raw syntax errors double up, and the per-file
    // Merge unions them. The server ships no catalog and never pulls `workspace/configuration`, so
    // The associations reach it only through `schemaAssociations` (the `settings` channel cannot).
    args: ["--stdio"],
    binary: "vscode-json-language-server",
    // Measured from the pinned binary's initialize reply: hover, documentSymbol, pullDiagnostics.
    provides: ["hover", "documentSymbol", "pullDiagnostics"],
    provision: { kind: "npm", packages: ["vscode-langservers-extracted@4.10.0"] },
    schemaAssociations: builtinSchemas,
  },
  "oxlint": {
    args: ["--lsp"],
    binary: "oxlint",
    // Oxlint validates only once it has workspace options; passing them inline (and answering its
    // `workspace/configuration` pull defensively, via `settings`) makes it publish on didOpen.
    // `run: onType` lints the open buffer; `configPath: null` finds `.oxlintrc.json` or defaults.
    initializationOptions: [
      { options: { configPath: null, run: "onType" }, workspaceUri: "{repoUri}" },
    ],
    provides: [],
    provision: { kind: "npm", packages: ["oxlint@1.72.0"] },
    settings: { configPath: null, run: "onType" },
  },
  // Ruff is the always-on Python linter (the oxlint analog), run over its LSP (`ruff server`). It is
  // Not on npm, so it comes through the binary channel as a `tar.gz` cargo-dist archive (the binary
  // Nested one directory in), sha256-verified per platform against the release's `.sha256` companion
  // Before the extractor pulls it out. Lint plus hover (measured from the pinned binary's initialize).
  "ruff": {
    args: ["server"],
    binary: "ruff",
    discovery: "python",
    provides: ["hover"],
    provision: {
      archive: "tar.gz",
      assets: [
        {
          arch: "arm64",
          asset: "ruff-aarch64-apple-darwin.tar.gz",
          os: "darwin",
          sha256: "0452f9d5da6e8051d332cf21ae82a608d8e2cfeec5a71a46ffa9e50adbb2381d",
        },
        {
          arch: "x64",
          asset: "ruff-x86_64-apple-darwin.tar.gz",
          os: "darwin",
          sha256: "7e6ff3bd585b5b7c47634c957ac84fb5806d3c7ab4ef0e5ec1c53ce272f489da",
        },
        {
          arch: "arm64",
          asset: "ruff-aarch64-unknown-linux-gnu.tar.gz",
          os: "linux",
          sha256: "9846136be7fe5b70351d5bde22fd21d4b3ab55b07c9793fdf190040b296ee9a3",
        },
        {
          arch: "x64",
          asset: "ruff-x86_64-unknown-linux-gnu.tar.gz",
          os: "linux",
          sha256: "7ddba1886f39ba918587f9ca37de9651008726834811c19ee83991705bd3e56b",
        },
      ],
      kind: "binary",
      repo: "astral-sh/ruff",
      tag: "0.15.21",
    },
  },
  // A single gzipped per-platform GitHub release asset (rust-analyzer is not an npm package), pinned
  // By tag and per-asset sha256 from the release API's digests. It answers pull diagnostics and
  // Pushes its cargo-check findings, the hybrid shape the retrieval path is built for.
  "rust-analyzer": {
    args: [],
    binary: "rust-analyzer",
    // `files.watcher` defaults to `client`, so advertising `didChangeWatchedFiles` would flip
    // Rust-analyzer off its own `notify` backend and onto stet's event stream. It watches itself
    // Correctly today (which is why `cargo add` already works), and stet has no reason to take that
    // Over: pinning `server` keeps it self-watching, so the watched-files channel is a no-op for
    // Rust. Helix ships the same pin for the same reason.
    initializationOptions: { files: { watcher: "server" } },
    provides: [
      "definition",
      "references",
      "hover",
      "documentSymbol",
      "callHierarchy",
      "implementation",
    ],
    provision: {
      assets: [
        {
          arch: "arm64",
          asset: "rust-analyzer-aarch64-apple-darwin.gz",
          os: "darwin",
          sha256: "0fb2229496105666460d22d062a55e154c862bb8004c464a38c6ffaff6fd68fe",
        },
        {
          arch: "x64",
          asset: "rust-analyzer-x86_64-apple-darwin.gz",
          os: "darwin",
          sha256: "3a6bc5b42c27d3f8d308dacb25fdbe9bba0577be2970500cdb936e53c21c3496",
        },
        {
          arch: "arm64",
          asset: "rust-analyzer-aarch64-unknown-linux-gnu.gz",
          os: "linux",
          sha256: "7e2627d96c6f1614115d212b61fd5f8dc9279853054b800f2b023c883e3ae056",
        },
        {
          arch: "x64",
          asset: "rust-analyzer-x86_64-unknown-linux-gnu.gz",
          os: "linux",
          sha256: "2fb596e12676e512de5dbf1c322dd591127ee089a1cca47995605593f2fc8850",
        },
      ],
      kind: "binary",
      repo: "rust-lang/rust-analyzer",
      tag: "2026-07-06",
    },
  },
  // Astral's Python type checker is an alternative to basedpyright, not an additional checker.
  // Python's `firstOf` profile selects it only where the repository opted into ty. Its initialize
  // Result advertises every intel provider stet uses except `implementation`.
  "ty": {
    args: ["server"],
    binary: "ty",
    discovery: "python",
    provides: ["definition", "references", "hover", "documentSymbol", "callHierarchy"],
    provision: {
      archive: "tar.gz",
      assets: [
        {
          arch: "arm64",
          asset: "ty-aarch64-apple-darwin.tar.gz",
          os: "darwin",
          sha256: "eab18cbeec298d9b59a374d3b49b5e17827118119a0a43d47f25eb847c93b390",
        },
        {
          arch: "x64",
          asset: "ty-x86_64-apple-darwin.tar.gz",
          os: "darwin",
          sha256: "6bb09b2941ada692fdaf295883904a59a652bb49e068fb95e04523039e412065",
        },
        {
          arch: "arm64",
          asset: "ty-aarch64-unknown-linux-gnu.tar.gz",
          os: "linux",
          sha256: "62dcb82bfc10bc538eb7cd45dfa9a6f9d9f6eec9f05480bda63b26decbd948fd",
        },
        {
          arch: "x64",
          asset: "ty-x86_64-unknown-linux-gnu.tar.gz",
          os: "linux",
          sha256: "1e756543bc02420dbd63189ace4316fa7f3dbf7800b066d3b9db477b215894e0",
        },
      ],
      kind: "binary",
      repo: "astral-sh/ty",
      tag: "0.0.58",
    },
    when: [
      "ty.toml",
      ".ty.toml",
      { file: "pyproject.toml", key: ["tool", "ty"] },
      { dependency: "ty", file: "pyproject.toml" },
    ],
  },
  "typescript": {
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
    provision: { kind: "npm", packages: ["typescript-language-server@5.3.0", "typescript@6.0.3"] },
  },
  "yaml": {
    args: ["--stdio"],
    binary: "yaml-language-server",
    // Measured from the pinned binary's initialize reply: definition, hover, documentSymbol.
    provides: ["definition", "hover", "documentSymbol"],
    provision: { kind: "npm", packages: ["yaml-language-server@1.23.0"] },
    // The server pulls `workspace/configuration` and fetches the SchemaStore catalog itself once
    // `schemaStore.enable` is on, so it validates well-known YAML (GitHub workflows, and so on)
    // With no client-supplied associations. `validate` is the master diagnostics switch.
    settings: { schemaStore: { enable: true }, validate: true },
  },
};

export const registry: Record<string, ServerSpec> = { ...builtinRegistry };

function configurationItems(params: unknown): unknown[] {
  return isObject(params) && Array.isArray(params.items) ? params.items : [];
}

// Deep-substitute the repo placeholders in every string leaf of a JSON value, so registry (and
// Eventually user-config) server options express per-repo values as data. One pass over the
// Original string, so a repo path that itself contains a placeholder token is never rescanned.
function substitutePlaceholders(value: unknown, repoRoot: string): unknown {
  if (typeof value === "string") {
    return value.replaceAll(/\{repo(?:Root|Uri)\}/g, (token) =>
      token === "{repoRoot}" ? repoRoot : pathToFileURL(repoRoot).href,
    );
  }
  if (Array.isArray(value)) {
    return value.map((item) => substitutePlaceholders(item, repoRoot));
  }
  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substitutePlaceholders(item, repoRoot)]),
    );
  }
  return value;
}

/**
 * The handshake extras for a server: the `handshake` closure verbatim when present (the escape
 * hatch), otherwise derived from the `initializationOptions`/`settings`/`schemaAssociations` data.
 * `settings` answers every `workspace/configuration` item with one substituted copy and advertises
 * the workspace caps that invite the pull; other server-to-client requests keep the transport's
 * null default. `schemaAssociations` becomes a post-`initialized` `json/schemaAssociations`
 * notification, the only channel that reaches the JSON server's schema map.
 */
export function handshakeConfigFor(
  spec: Pick<ServerSpec, "handshake" | "initializationOptions" | "schemaAssociations" | "settings">,
  repoRoot: string,
): HandshakeConfig | undefined {
  if (spec.handshake !== undefined) {
    return spec.handshake(repoRoot);
  }
  if (
    spec.initializationOptions === undefined &&
    spec.settings === undefined &&
    spec.schemaAssociations === undefined
  ) {
    return undefined;
  }
  const settings =
    spec.settings === undefined ? undefined : substitutePlaceholders(spec.settings, repoRoot);
  return {
    ...(spec.initializationOptions === undefined
      ? {}
      : { initializationOptions: substitutePlaceholders(spec.initializationOptions, repoRoot) }),
    ...(settings === undefined
      ? {}
      : {
          onRequest: (method: string, params: unknown) =>
            Effect.succeed(
              method === "workspace/configuration"
                ? configurationItems(params).map(() => settings)
                : null,
            ),
          workspaceCapabilities: { configuration: true, workspaceFolders: true },
        }),
    ...(spec.schemaAssociations === undefined
      ? {}
      : {
          notifications: [
            {
              method: "json/schemaAssociations",
              params: substitutePlaceholders(spec.schemaAssociations, repoRoot),
            },
          ],
        }),
  };
}

// Test-only: the server registry is process-global; snapshot before and restore after so a test
// That registers servers never leaks them into later tests.
export function snapshotServers() {
  return { ...registry };
}

export function restoreServers(snapshot: ReturnType<typeof snapshotServers>) {
  for (const key of Object.keys(registry)) {
    delete registry[key];
  }
  Object.assign(registry, snapshot);
}

/** Replace the startup registry after config validation. */
export function registerServers(entries: Record<string, ServerSpec>) {
  for (const key of Object.keys(registry)) {
    delete registry[key];
  }
  Object.assign(registry, entries);
}

export interface ResolvedServers {
  servers: Record<string, ServerSpec>;
  issues: string[];
}

const capabilityNames = [
  "definition",
  "references",
  "hover",
  "documentSymbol",
  "callHierarchy",
  "implementation",
  "pullDiagnostics",
] as const satisfies readonly Capability[];

function isCapability(value: unknown): value is Capability {
  return typeof value === "string" && capabilityNames.some((capability) => capability === value);
}

/** Resolve named server overrides. An invalid override leaves its built-in unchanged. */
export function resolveServers(raw: Record<string, unknown>): ResolvedServers {
  const issues: string[] = [];
  const servers: Record<string, ServerSpec> = { ...builtinRegistry };
  const fields = new Set([
    "capabilities",
    "command",
    "discovery",
    "initializationOptions",
    "settings",
    "when",
  ]);

  for (const [name, entry] of Object.entries(raw)) {
    if (entry === false) {
      delete servers[name];
      continue;
    }
    if (!isObject(entry)) {
      issues.push(`server "${name}": must be an object or false`);
      continue;
    }
    const unknown = Object.keys(entry).filter((field) => !fields.has(field));
    if (unknown.length > 0) {
      issues.push(...unknown.map((field) => `server "${name}": unknown field "${field}"`));
      continue;
    }
    const base = servers[name];
    const command = entry.command;
    if (command === undefined && base === undefined) {
      issues.push(`server "${name}": a new server requires command`);
      continue;
    }
    const parts =
      command === undefined
        ? undefined
        : Array.isArray(command)
          ? command.filter((part): part is string => typeof part === "string" && part !== "")
          : [];
    if (command !== undefined && (!Array.isArray(command) || parts?.length !== command.length)) {
      issues.push(`server "${name}": command must be a non-empty array of non-empty strings`);
      continue;
    }
    const [binary, ...args] = parts ?? [];
    if (command !== undefined && binary === undefined) {
      issues.push(`server "${name}": command must not be empty`);
      continue;
    }
    const rawDiscovery = entry.discovery;
    if (rawDiscovery !== undefined && rawDiscovery !== false && rawDiscovery !== "python") {
      issues.push(`server "${name}": discovery must be "python" or false`);
      continue;
    }
    const discovery = rawDiscovery === false ? undefined : (rawDiscovery ?? base?.discovery);
    const capabilities = entry.capabilities;
    const provides =
      capabilities === undefined
        ? (base?.provides ?? [...intelCapabilities])
        : Array.isArray(capabilities)
          ? capabilities.filter(isCapability)
          : [];
    if (
      capabilities !== undefined &&
      (!Array.isArray(capabilities) || provides.length !== capabilities.length)
    ) {
      issues.push(`server "${name}": capabilities contains an unknown capability`);
      continue;
    }
    let when = base?.when;
    if (entry.when === false) {
      when = undefined;
    } else if (entry.when !== undefined) {
      const parsed = parseWhen(entry.when);
      if (parsed.when === undefined) {
        issues.push(...parsed.issues.map((issue) => `server "${name}": ${issue}`));
        continue;
      }
      when = parsed.when;
    }
    const next: ServerSpec = {
      args: command === undefined ? (base?.args ?? []) : args,
      binary: command === undefined ? (base?.binary ?? "") : (binary ?? ""),
      ...(discovery === undefined ? {} : { discovery }),
      provides,
      ...(command === undefined && base?.provision !== undefined
        ? { provision: base.provision }
        : {}),
      ...(base?.handshake === undefined ? {} : { handshake: base.handshake }),
      ...(entry.initializationOptions === undefined
        ? base?.initializationOptions === undefined
          ? {}
          : { initializationOptions: base.initializationOptions }
        : { initializationOptions: entry.initializationOptions }),
      ...(entry.settings === undefined
        ? base?.settings === undefined
          ? {}
          : { settings: base.settings }
        : { settings: entry.settings }),
      ...(when === undefined ? {} : { when }),
    };
    servers[name] = next;
  }

  return { issues, servers };
}

function entryServers(entry: ServerEntry): string[] {
  if (typeof entry === "string") {
    return [entry];
  }
  return "firstOf" in entry ? entry.firstOf.flatMap(entryServers) : [entry.server];
}

/** Every possible server for this path, with gates and first-of selection ignored. */
export function serversForPath(path: string): string[] {
  return [
    ...new Set(
      (fileSupportForPath(path).language?.servers ?? [])
        .flatMap(entryServers)
        .filter((server) => registry[server] !== undefined),
    ),
  ];
}

export interface ServerGates {
  readonly accepted: ReadonlyMap<string, boolean>;
}

const whenKey = (when: When) => JSON.stringify(when);
const serverGateCache = new Map<
  string,
  { readonly gates: ServerGates; readonly generation: number }
>();
const serverGateGenerations = new Map<string, number>();

function entryCandidates(entry: ServerEntry): readonly ServerCandidate[] {
  return typeof entry !== "string" && "firstOf" in entry ? entry.firstOf : [entry];
}

const evaluateServerGates = Effect.fn("LanguageServers.evaluateServerGates")(function* gates(
  repoRoot: string,
) {
  const whens = [
    ...Object.values(registry).flatMap((spec) => (spec.when === undefined ? [] : [spec.when])),
    ...[...registeredLanguageProfiles()].flatMap((profile) =>
      profile.servers.flatMap((entry) =>
        entryCandidates(entry).flatMap((candidate) =>
          typeof candidate === "string" || candidate.when === undefined ? [] : [candidate.when],
        ),
      ),
    ),
  ];
  const distinct = new Map(whens.map((when) => [whenKey(when), when]));
  const manifests = yield* makeManifestCache(repoRoot);
  const accepted = new Map(
    yield* Effect.all(
      [...distinct].map(([key, when]) =>
        evaluateWhen(when, repoRoot, manifests).pipe(
          Effect.map((passes) => [key, passes] satisfies readonly [string, boolean]),
        ),
      ),
      { concurrency: "unbounded" },
    ),
  );
  return { accepted };
});

function invalidateServerGates(repoRoot: string) {
  return Effect.sync(() => {
    serverGateGenerations.set(repoRoot, (serverGateGenerations.get(repoRoot) ?? 0) + 1);
    serverGateCache.delete(repoRoot);
  });
}

/** Memoize one completed gate snapshot per repository until its watcher reports a change. */
export const activeServerGates = Effect.fn("LanguageServers.activeServerGates")(
  function* activeGates(repoRoot: string) {
    const generation = serverGateGenerations.get(repoRoot) ?? 0;
    serverGateGenerations.set(repoRoot, generation);
    const cached = serverGateCache.get(repoRoot);
    if (cached?.generation === generation) {
      return cached.gates;
    }

    const gates = yield* evaluateServerGates(repoRoot);
    yield* Effect.sync(() => {
      if ((serverGateGenerations.get(repoRoot) ?? 0) === generation) {
        serverGateCache.set(repoRoot, { gates, generation });
      }
    });
    return gates;
  },
);

/** Apply server defaults, entry overrides, and first-of groups to one file. */
export function activeServers(path: string, gates: ServerGates): string[] {
  const passes = (when: When | undefined) =>
    when === undefined ? true : (gates.accepted.get(whenKey(when)) ?? false);
  const candidateActive = (candidate: ServerCandidate) => {
    const server = typeof candidate === "string" ? candidate : candidate.server;
    const spec = registry[server];
    if (spec === undefined) {
      return false;
    }
    return passes(typeof candidate === "string" ? spec.when : candidate.when);
  };
  const selected = (fileSupportForPath(path).language?.servers ?? []).flatMap((entry) => {
    if (typeof entry !== "string" && "firstOf" in entry) {
      const winner = entry.firstOf.find(candidateActive);
      return winner === undefined ? [] : entryServers(winner);
    }
    return candidateActive(entry) ? entryServers(entry) : [];
  });
  return [...new Set(selected)];
}

export const activeServersForPath = Effect.fn("LanguageServers.activeServersForPath")(
  function* serversForActivePath(path: string, repoRoot: string) {
    return activeServers(path, yield* activeServerGates(repoRoot));
  },
);

export const serversProviding = Effect.fn("LanguageServers.serversProviding")(function* providing(
  path: string,
  capability: Capability,
  repoRoot: string,
) {
  const servers = yield* activeServersForPath(path, repoRoot);
  return servers.filter((server) => registry[server]?.provides.includes(capability));
});

const intelCapabilities = new Set<Capability>([
  "definition",
  "references",
  "hover",
  "documentSymbol",
  "callHierarchy",
  "implementation",
]);

/** Whether this path has any possible code-intel server before repository gates are evaluated. */
export function hasIntelServer(path: string) {
  return serversForPath(path).some((server) =>
    (registry[server]?.provides ?? []).some((capability) => intelCapabilities.has(capability)),
  );
}

/**
 * Whether any possible server for this path statically declares `capability`, before repository
 * gates. A sync over-approximation (gates ignored) that lets a caller skip the async gate pull for
 * a file type no server could ever answer, the same shortcut `hasIntelServer` gives the warm-hold.
 */
export function hasCapabilityServer(path: string, capability: Capability) {
  return serversForPath(path).some((server) =>
    (registry[server]?.provides ?? []).includes(capability),
  );
}

/**
 * The LSP `languageId` for `didOpen`, from the owning language's file-type map; `plaintext` when no
 * language claims the file (a server never analyzes a `plaintext` document).
 */
export function lspLanguageId(path: string): string {
  return fileSupportForPath(path).language?.languageId ?? "plaintext";
}

// Discovery tiers: a repo-local binary or one on PATH wins; otherwise a server stet has already
// Provisioned into its cache. A not-yet-provisioned server returns undefined (acquire then installs).
export function resolveServerCommand(language: string, repoRoot: string): string[] | undefined {
  const spec = registry[language];
  if (spec === undefined) {
    return undefined;
  }
  const repoOrPath = resolveBinary(repoRoot, spec.binary, spec.discovery);
  if (repoOrPath !== undefined) {
    return [repoOrPath, ...spec.args];
  }
  if (spec.provision !== undefined) {
    const cached = cachedBinaryPath(language, {
      args: spec.args,
      binary: spec.binary,
      channel: spec.provision,
    });
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
  return { args: spec.args, binary: spec.binary, channel: spec.provision };
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
 *
 * @param repoRoot - The repository root used for workspace initialization
 * @param config - Optional initialization options, workspace capabilities, and request handler
 * @returns The initialized server handle with its advertised capabilities
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
            // Pull diagnostics: a server that advertises `diagnosticProvider` only answers
            // `textDocument/diagnostic` when the client declares this cap. Push stays advertised
            // Alongside (publishDiagnostics below): the two are concurrent channels, and a hybrid
            // Server (rust-analyzer) pulls its native findings while pushing its cargo-check ones.
            diagnostic: { dynamicRegistration: false, relatedDocumentSupport: true },
            documentSymbol: { dynamicRegistration: false, hierarchicalDocumentSymbolSupport: true },
            hover: { dynamicRegistration: false },
            implementation: { dynamicRegistration: false, linkSupport: true },
            publishDiagnostics: { relatedInformation: true, versionSupport: false },
            references: { dynamicRegistration: false },
            synchronization: { didSave: false, dynamicRegistration: false },
          },
          // Opt into server-driven progress so tsserver reports project-load begin/end; intel pulls
          // Gate on the "end" (see `whenProjectLoaded`), and without this it sends no progress at all.
          window: { workDoneProgress: true },
          // `diagnostics.refreshSupport` tells the server it may nudge a re-pull via
          // `workspace/diagnostic/refresh`; a server that pulls its settings (oxlint) adds its
          // Workspace caps alongside. `didChangeWatchedFiles` is the other half of document sync:
          // Without it a server never learns about a file it does not own as a document (a package
          // Installed into `.venv`/`node_modules`, a `tsconfig.json` edit), so its resolution caches
          // Go stale and never recover. basedpyright does no filesystem watching of its own and
          // Gates its whole watch feature on `dynamicRegistration`, so this is the only channel by
          // Which it can learn anything about disk. `relativePatternSupport` is what makes it
          // Register its Python search paths (an out-of-worktree venv), which `watchedBases` then
          // Watches; declining it would leave a conda/pyenv env unrecoverable without a restart.
          workspace: {
            diagnostics: { refreshSupport: true },
            didChangeWatchedFiles: { dynamicRegistration: true, relativePatternSupport: true },
            ...config?.workspaceCapabilities,
          },
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
    // One-shot notifications the server only accepts after `initialized` (the JSON server's schema
    // Associations); a server with none pays nothing.
    yield* Effect.forEach(
      config?.notifications ?? [],
      (message) => connection.notify(message.method, message.params),
      { discard: true },
    );
    return {
      capabilities: parseCapabilities(result),
      connection,
    } satisfies ServerHandle;
  });
}

// The debounce the whole ecosystem converged on: both the git watcher here and the LSP file watchers
// In Zed and Neovim coalesce a burst into one notification at 100ms.
const BASE_DEBOUNCE_MS = 100;

/** Nothing under an out-of-tree registered base is in the git tree, so nothing there is tracked. */
const NEVER_TRACKED = () => false;

/**
 * A watch on one directory a server named that stet's worktree watcher cannot see: the Python
 * search paths pyright registers when the venv is a conda/pyenv/global env rather than an in-repo
 * `.venv`.
 *
 * **Non-recursive on purpose.** An install, uninstall, or upgrade always touches direct children of
 * `site-packages` (`fastapi/`, `fastapi-x.y.dist-info/`, a `.pth` file), and pyright reloads its
 * library wholesale on any single matching event, so one handle per base carries the whole signal.
 * Watching a large conda env recursively would mean one inotify handle per directory, which is the
 * exhaustion that made Neovim disable this feature on Linux outright; deriving watchers from server
 * globs is exactly the trap being avoided here. A failed watch is swallowed, as the git watcher's
 * is: that base simply goes unwatched, which is where stet already was.
 *
 * @param base - The directory to watch.
 */
function baseChanges(base: string) {
  return Stream.callback<readonly WatchedPathChange[]>(
    (queue) =>
      Effect.gen(function* watchBase() {
        // Path -> whether it was renamed (appeared/vanished) rather than rewritten in place. A
        // Package install is a *creation* under the search path, and that distinction is what makes
        // Pyright rescan for it rather than merely re-read what it already knew (`watchedFileEvent`).
        const pending = new Map<string, boolean>();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const flush = () => {
          timer = undefined;
          const changes = [...pending].map(([path, renamed]) => ({ path, renamed }));
          // Keep the batch if the offer is dropped, and retry: a lost batch here is a dependency
          // Install the server never hears about, which is the bug this whole channel exists to fix.
          if (Queue.offerUnsafe(queue, changes)) {
            pending.clear();
          } else if (pending.size > 0) {
            timer = setTimeout(flush, BASE_DEBOUNCE_MS);
          }
        };
        const watcher = (() => {
          try {
            const started = watch(base, { recursive: false }, (event, filename) => {
              if (typeof filename !== "string") {
                return;
              }
              pending.set(filename, (pending.get(filename) ?? false) || event === "rename");
              if (timer !== undefined) {
                clearTimeout(timer);
              }
              timer = setTimeout(flush, BASE_DEBOUNCE_MS);
            });
            started.on("error", () => {});
            return started;
          } catch {
            return undefined;
          }
        })();
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (timer !== undefined) {
              clearTimeout(timer);
            }
            watcher?.close();
          }),
        );
        return yield* Effect.never;
      }),
    { bufferSize: 1, strategy: "dropping" },
  );
}

/**
 * Starts an LSP server, completes its handshake, and monitors registered external bases for file
 * changes.
 *
 * @param command - The server executable and its arguments
 * @param repoRoot - The repository root used to start and initialize the server
 * @param config - Optional handshake configuration
 * @returns A handle for communicating with the initialized server
 */
function connectServer(command: readonly string[], repoRoot: string, config?: HandshakeConfig) {
  return Effect.gen(function* connect() {
    const lsp = yield* LspProcess;
    const connection = yield* lsp.start(command, repoRoot, config?.onRequest);
    const handle = yield* performHandshake(connection, repoRoot, config);
    // Watch the bases the server registers outside the worktree, re-keying whenever its registrations
    // Change (`switchMap` tears down the previous set, so an unregister stops its watch). The fiber
    // Lives in the connection's scope, so every handle dies with the server.
    yield* Effect.forkScoped(
      connection.watchedBases.pipe(
        Stream.switchMap((bases) =>
          Stream.mergeAll(
            bases.map((base) =>
              baseChanges(base).pipe(Stream.map((changes) => ({ base, changes }))),
            ),
            { concurrency: "unbounded" },
          ),
        ),
        // An out-of-tree base is a package directory, never part of the git tree, so nothing under it
        // Is ever tracked: every rename there is a genuine appearance, which is the install itself.
        Stream.runForEach(({ base, changes }) =>
          connection.watchedFilesChanged(base, changes, NEVER_TRACKED),
        ),
      ),
    );
    // Best-effort graceful teardown before the child is killed on scope close.
    yield* Effect.addFinalizer(() =>
      connection
        .request("shutdown")
        .pipe(Effect.andThen(connection.notify("exit")), Effect.timeout("1 second"), Effect.ignore),
    );
    return handle;
  });
}

export function serverRepoKey(server: string, repoRoot: string) {
  return `${server.length}:${server}${repoRoot}`;
}

function serverRepoFromKey(key: string) {
  const separator = key.indexOf(":");
  const serverStart = separator + 1;
  const repoStart = serverStart + Number.parseInt(key.slice(0, separator), 10);
  return { repoRoot: key.slice(repoStart), server: key.slice(serverStart, repoStart) };
}

function lookupServer(
  key: string,
): Effect.Effect<
  ServerHandle,
  ServerUnavailable | LspSpawnError | LspRequestError,
  LspProcess | Scope.Scope
> {
  const { repoRoot, server: language } = serverRepoFromKey(key);
  const command = resolveServerCommand(language, repoRoot);
  if (command === undefined) {
    return Effect.fail(
      new ServerUnavailable({ language, message: `no language server for ${language}` }),
    );
  }
  const spec = registry[language];
  return connectServer(
    command,
    repoRoot,
    spec === undefined ? undefined : handshakeConfigFor(spec, repoRoot),
  );
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
    /**
     * Tell every live server for this repo about on-disk changes, each filtered against its own
     * registered globs. Broadcast from the pool rather than from a keeper, so a server held only by
     * the intel warm-hold hears about them too. The batch stays **raw** all the way down: typing a
     * path costs a stat, and only the server's own globs know whether any path is worth one.
     */
    readonly notifyWatchedFiles: (
      repoRoot: string,
      changes: readonly WatchedPathChange[],
      isTracked: (path: string) => boolean,
    ) => Effect.Effect<void>;
    /**
     * Evict this repo's pooled servers so the next run brings up fresh ones. The escape hatch
     * behind `R`, for a server that cannot be told about a change (a linter that reads its config
     * once at startup) or has simply wedged. Callers close their keepers first, or the dropped pool
     * references keep the old children alive.
     */
    readonly restart: (repoRoot: string) => Effect.Effect<void>;
  }
>()("stet/LanguageServers") {}

type AcquireError = ServerUnavailable | ServerInstalling | LspSpawnError | LspRequestError;

export const LanguageServersLive = Layer.effect(
  LanguageServers,
  Effect.gen(function* languageServers() {
    const provisioner = yield* Provisioner;
    // `RcMap` can hand a handle back but cannot enumerate the ones it is holding (`RcMap.get` would
    // Acquire, spawning a server rather than listing one), so mirror the live handles here. The
    // Finalizer runs on the pool entry's own scope, so an idled-out or evicted server drops out of
    // The mirror by construction.
    const live = new Map<string, ServerHandle>();
    const pool = yield* RcMap.make({
      idleTimeToLive: "30 seconds",
      lookup: (key: string) =>
        lookupServer(key).pipe(
          Effect.tap((handle) =>
            Effect.sync(() => live.set(key, handle)).pipe(
              Effect.andThen(
                Effect.addFinalizer(() =>
                  Effect.sync(() => {
                    // Retract only the handle this entry installed. `RcMap.invalidate` drops a
                    // Still-referenced key from the pool *without* closing its scope (the intel
                    // Warm-hold keeps a reference for the whole session), so a replacement server
                    // Can be spawned and registered here long before the old entry's finalizer
                    // Finally runs. A blind `delete(key)` would then retract the live server, and
                    // The watched-files channel would go silently dead for the rest of the session.
                    if (live.get(key) === handle) {
                      live.delete(key);
                    }
                  }),
                ),
              ),
            ),
          ),
        ),
    });

    const keysFor = (repoRoot: string) =>
      [...live.keys()].filter((key) => serverRepoFromKey(key).repoRoot === repoRoot);

    const notifyWatchedFiles = (
      repoRoot: string,
      changes: readonly WatchedPathChange[],
      isTracked: (path: string) => boolean,
    ) =>
      invalidateServerGates(repoRoot).pipe(
        Effect.andThen(
          Effect.suspend(() =>
            Effect.forEach(
              keysFor(repoRoot),
              (key) =>
                live.get(key)?.connection.watchedFilesChanged(repoRoot, changes, isTracked) ??
                Effect.void,
              { discard: true },
            ),
          ),
        ),
      );

    const restart = (repoRoot: string) =>
      Effect.suspend(() => {
        const keys = keysFor(repoRoot);
        // Stop routing to a server we are evicting. `RcMap.invalidate` leaves a still-referenced
        // Entry's scope open, so its finalizer (which is what normally retracts the handle) may not
        // Run for a long time, and until the replacement is acquired every watched-file change would
        // Otherwise be delivered to the orphan instead of the server the user is looking at.
        for (const key of keys) {
          live.delete(key);
        }
        return invalidateServerGates(repoRoot).pipe(
          Effect.andThen(
            Effect.forEach(keys, (key) => RcMap.invalidate(pool, key), { discard: true }),
          ),
        );
      });

    // Connect through the warm pool; if the pooled server died (its stdout closed), evict it and
    // Bring up a fresh one, so a crash mid-session recovers on the next run.
    const fromPool = (language: string, repoRoot: string) => {
      const key = serverRepoKey(language, repoRoot);
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

    return { acquire, notifyWatchedFiles, restart };
  }),
);
