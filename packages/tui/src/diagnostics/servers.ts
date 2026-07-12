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
import type { ProvisionChannel, ProvisionSpec } from "./provision";
import { pythonTypeChecker } from "./python";
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
   * Escape hatch for handshake shapes the `initializationOptions`/`settings` data can't express (a
   * server whose `workspace/configuration` answer depends on the request's items). When set it
   * replaces the data-derived handshake entirely. No built-in uses it today.
   */
  readonly handshake?: (repoRoot: string) => HandshakeConfig;
  /**
   * When set, the server runs only in repos this predicate accepts. oxlint/typescript run in every
   * JS/TS repo, but a competing linter like Biome should activate only where the repo opted into it
   * (a `biome.json`), the way an editor's Biome extension does, so it neither downloads into repos
   * that don't use it nor duplicates oxlint's findings. Python's two type checkers use it for a
   * mutual exclusion rather than an opt-in: both gate on the same `pythonTypeChecker` answer, so a
   * repo runs exactly one of them.
   */
  readonly detect?: (repoRoot: string) => boolean;
}

// Adding a language is one `languages` entry (its file types and server order) plus a `registry`
// Entry per new server; the transport, pool, and handshake are language-agnostic. When a server or
// Language changes here, update docs/content/docs/reference/languages.mdx to match (hand-written
// By choice; the table is small and slow-moving). A language lists
// Every server that analyzes it (typescript type-checks the JS/TS family, oxlint lints the same
// Files) and the per-file results merge. A server with a `detect` gate runs only where its
// Predicate accepts the repo (Biome needs a biome config), which is also how a language with more
// Than one type checker picks the repo's (python lists both basedpyright and ty, and runs one).
//
// `provision.packages` pin exact versions, never a bare name that resolves `@latest`: the tier-3
// Download is otherwise nondeterministic (whatever the registry serves that day) and would pull a
// Broken or compromised upstream release automatically, a weaker bar than stet's own pinned
// Distribution. Pinning also lets npm verify the tarball against its immutable published version.
// Bumping a pin is an explicit reviewable edit; the cache is keyed by the pinned set (`provisionKey`)
// So a bump re-provisions. The oxlint/typescript pins deliberately track this repo's own devDeps but
// Are independent (stet's build toolchain vs. the LSP server it downloads into arbitrary repos).
export const registry: Record<string, ServerSpec> = {
  // The basedpyright fork reinstates the read-only providers pyright gates behind its VS Code
  // Extension; the npm package ships `basedpyright-langserver`. It type-checks Python and answers
  // The code-intel pulls, the typescript-language-server analog. Zero-config: it reads
  // Pyrightconfig/pyproject on its own and pulls `python.*` settings the transport's null default
  // Answers, so it needs no handshake extras. It is Python's default checker, not its only one: a
  // Repo that opted into ty runs ty instead, so the two never double-report the same code.
  "basedpyright": {
    args: ["--stdio"],
    binary: "basedpyright-langserver",
    detect: (repoRoot) => pythonTypeChecker(repoRoot) === "basedpyright",
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
    // Read off disk; `detect` guarantees a biome config exists, so Biome resolves it on its own and
    // The transport's null default answers its `workspace/configuration` pull. No handshake needed.
    detect: (repoRoot) =>
      existsSync(join(repoRoot, "biome.json")) || existsSync(join(repoRoot, "biome.jsonc")),
    provides: [],
    provision: { kind: "npm", packages: ["@biomejs/biome@2.5.2"] },
  },
  "json": {
    // Always-on (no `detect`) so JSON gets schema validation in every repo. It overlaps Biome's
    // Json coverage where a biome config exists, but the two are complementary: Biome lints, this
    // Validates against schemas (package.json/tsconfig/SchemaStore); only raw syntax errors double
    // Up, and the per-file merge unions them.
    args: ["--stdio"],
    binary: "vscode-json-language-server",
    provides: [],
    provision: { kind: "npm", packages: ["vscode-langservers-extracted@4.10.0"] },
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
  // Before the extractor pulls it out. Lint only, no code intel, so `provides` is empty.
  "ruff": {
    args: ["server"],
    binary: "ruff",
    provides: [],
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
  // Astral's Python type checker, run over its LSP (`ty server`). It is the basedpyright alternative,
  // Not an addition: `detect` runs it only where the repo opted into it, and turns basedpyright off
  // There, so the panel shows what the project's own `ty check` shows. Same cargo-dist release shape
  // As ruff, so it comes through the same sha256-pinned `tar.gz` binary channel. Its `initialize`
  // Result advertises every intel provider stet pulls except `implementation`, hence its absence
  // Below; a ty repo reports that key as unsupported rather than keeping a second type checker alive
  // To answer it.
  "ty": {
    args: ["server"],
    binary: "ty",
    detect: (repoRoot) => pythonTypeChecker(repoRoot) === "ty",
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
    provides: [],
    provision: { kind: "npm", packages: ["yaml-language-server@1.23.0"] },
  },
};

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
 * hatch), otherwise derived from the `initializationOptions`/`settings` data. `settings` answers
 * every `workspace/configuration` item with one substituted copy and advertises the workspace caps
 * that invite the pull; other server-to-client requests keep the transport's null default.
 */
export function handshakeConfigFor(
  spec: Pick<ServerSpec, "handshake" | "initializationOptions" | "settings">,
  repoRoot: string,
): HandshakeConfig | undefined {
  if (spec.handshake !== undefined) {
    return spec.handshake(repoRoot);
  }
  if (spec.initializationOptions === undefined && spec.settings === undefined) {
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
  };
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
  /**
   * The `servers` list came from the user's config rather than the built-in table, so it is a
   * statement of intent, not stet's guess at one. The repo gates (`detect`) exist only to make that
   * guess, so they don't apply here: naming `biome` runs it without a `biome.json`, and naming a
   * Python type checker runs it whatever the repo declares. Without this the guess would overrule
   * the statement, and a named-but-gated server would silently run nothing. A partial override
   * (file types only) inherits the built-in list and stays gated, since it states nothing about
   * servers.
   */
  readonly serversFromConfig?: boolean;
  /**
   * The user's own repo gates, from a server entry's `when`: server key -> paths, any one of which
   * existing in the repo activates it. Keyed per language, not per server, because the same server
   * may be gated here and built-in-gated elsewhere. Config-only; a built-in expresses its gate as a
   * `detect` predicate instead, which can do what paths can't (Python's reads pyproject).
   */
  readonly serverGates?: Record<string, readonly string[]>;
}

// No built-in declares `filenames` yet; it routes extensionless types (Dockerfile, Makefile) the
// Day a server for one lands, resolving exact-name-then-extension the way the icon and highlighter
// Lookups already do.
const builtinLanguages: Record<string, Language> = {
  css: { extensions: { css: "css" }, servers: ["biome"] },
  graphql: { extensions: { graphql: "graphql" }, servers: ["biome"] },
  json: { extensions: { json: "json", jsonc: "jsonc" }, servers: ["json", "biome"] },
  // The repo's type checker (basedpyright, or ty where the repo opted into it) type-checks and
  // Answers intel; exactly one of the two ever runs, gated on `pythonTypeChecker`. ruff lints
  // (always-on, the default Python linter, not a competitor to one, so no `detect` gate). `.pyi`
  // Stubs open as python too.
  python: { extensions: { py: "python", pyi: "python" }, servers: ["basedpyright", "ty", "ruff"] },
  rust: { extensions: { rs: "rust" }, servers: ["rust-analyzer"] },
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

// Test-only: the server registry is process-global like the language table; snapshot before and
// Restore after so a test that registers servers never leaks them into later tests.
export function snapshotServers() {
  return { ...registry };
}

export function restoreServers(snapshot: ReturnType<typeof snapshotServers>) {
  for (const key of Object.keys(registry)) {
    delete registry[key];
  }
  Object.assign(registry, snapshot);
}

/** Merge servers into the registry; the config layer registers synthesized user servers here. */
export function registerServers(entries: Record<string, ServerSpec>) {
  Object.assign(registry, entries);
}

export interface ResolvedLanguages {
  languages: Record<string, Language>;
  servers: Record<string, ServerSpec>;
  issues: string[];
}

/**
 * Resolve raw config `languages` entries into registrable languages plus the server specs their
 * inline commands synthesize, mirroring `resolveThemes`: every problem lands in `issues` rather
 * than thrown, so one bad entry never sinks the rest. A partial entry merges over its built-in per
 * field (absent fields inherit; `servers` replaces the whole list, which is how a linter is
 * dropped). A user language's file types take the language key as their LSP `languageId` unless the
 * built-in already maps them, and a file type another language owns is reported and skipped, never
 * silently shadowed. Inline servers resolve repo-local -> PATH only (no `provision`, no `detect`)
 * and declare every intel capability optimistically: the handshake-advertised set on `ServerHandle`
 * is the authoritative gate, so over-declaring costs one acquire, not a wrong answer.
 */
export function resolveLanguages(raw: Record<string, unknown>): ResolvedLanguages {
  const issues: string[] = [];
  const resolvedLanguages: Record<string, Language> = {};
  const resolvedServers: Record<string, ServerSpec> = {};

  const fileTypes = (
    name: string,
    field: "extensions" | "filenames",
    value: unknown,
    builtin: Record<string, string> | undefined,
  ) => {
    const items = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item !== "")
      : undefined;
    if (items === undefined || (Array.isArray(value) && items.length !== value.length)) {
      issues.push(`language "${name}": ${field} must be an array of non-empty strings`);
      return undefined;
    }
    return Object.fromEntries(
      items.map((item) => {
        // Tolerate a ".py"-style leading dot on extensions; the matcher keys bare suffixes.
        const key = field === "extensions" ? item.replace(/^\./, "") : item;
        return [key, builtin?.[key] ?? name];
      }),
    );
  };

  const uniqueServerKey = (base: string) => {
    if (registry[base] === undefined && resolvedServers[base] === undefined) {
      return base;
    }
    const taken = (key: string) =>
      registry[key] !== undefined || resolvedServers[key] !== undefined;
    const next = (index: number): string =>
      taken(`${base}-${index}`) ? next(index + 1) : `${base}-${index}`;
    return next(2);
  };

  const serverFields = new Set(["command", "initializationOptions", "server", "settings", "when"]);

  // A `when` is the user's own repo gate, expressed as data because config is data: any listed path
  // Existing in the repo activates the server. The built-ins keep a `detect` predicate for the gates
  // Paths can't express (Python's reads a declared dependency out of pyproject).
  const whenPaths = (name: string, when: unknown) => {
    const paths = Array.isArray(when)
      ? when.filter((path): path is string => typeof path === "string" && path !== "")
      : [];
    if (paths.length === 0 || !Array.isArray(when) || paths.length !== when.length) {
      issues.push(`language "${name}": when must be a non-empty array of repo paths`);
      return undefined;
    }
    return paths;
  };

  const serverList = (name: string, value: unknown) => {
    if (!Array.isArray(value)) {
      issues.push(`language "${name}": servers must be an array`);
      return undefined;
    }
    const servers: string[] = [];
    const gates: Record<string, readonly string[]> = {};
    for (const entry of value) {
      if (typeof entry === "string") {
        if (registry[entry] === undefined) {
          issues.push(`language "${name}": unknown server "${entry}"`);
          continue;
        }
        servers.push(entry);
        continue;
      }
      if (!isObject(entry)) {
        issues.push(
          `language "${name}": a server must be a built-in name, { server: "..." }, or { command: [...] }`,
        );
        continue;
      }
      for (const field of Object.keys(entry)) {
        if (!serverFields.has(field)) {
          issues.push(`language "${name}": unknown server field "${field}"`);
        }
      }
      if ((entry.server === undefined) === (entry.command === undefined)) {
        issues.push(`language "${name}": a server needs exactly one of "server" or "command"`);
        continue;
      }
      const gate = entry.when === undefined ? undefined : whenPaths(name, entry.when);
      if (entry.when !== undefined && gate === undefined) {
        continue;
      }
      // A built-in, named to attach a gate to it. Options are deliberately not accepted: they would
      // Need a spec of this server's own, but the pool keys per server and repo, so two languages
      // Could never disagree about one server's options. Only the gate is per-language.
      if (entry.server !== undefined) {
        if (typeof entry.server !== "string" || registry[entry.server] === undefined) {
          issues.push(`language "${name}": unknown server ${JSON.stringify(entry.server)}`);
          continue;
        }
        if (entry.initializationOptions !== undefined || entry.settings !== undefined) {
          issues.push(`language "${name}": a built-in server takes only "when"`);
          continue;
        }
        if (gate !== undefined) {
          gates[entry.server] = gate;
        }
        servers.push(entry.server);
        continue;
      }
      const command = Array.isArray(entry.command)
        ? entry.command.filter((part): part is string => typeof part === "string" && part !== "")
        : [];
      const [binary, ...args] = command;
      if (
        binary === undefined ||
        !Array.isArray(entry.command) ||
        command.length !== entry.command.length
      ) {
        issues.push(`language "${name}": an inline server's command must be non-empty strings`);
        continue;
      }
      const key = uniqueServerKey(`${name}/${binary.slice(binary.lastIndexOf("/") + 1)}`);
      resolvedServers[key] = {
        args,
        binary,
        provides: [...intelCapabilities],
        ...(entry.initializationOptions === undefined
          ? {}
          : { initializationOptions: entry.initializationOptions }),
        ...(entry.settings === undefined ? {} : { settings: entry.settings }),
      };
      if (gate !== undefined) {
        gates[key] = gate;
      }
      servers.push(key);
    }
    return { gates, servers };
  };

  // Pass 1: validate each entry into a proposal, no cross-entry checks yet. Only entries that
  // Survive every validation propose anything, so a skipped entry can never block another's
  // File types.
  interface Proposal {
    readonly name: string;
    readonly override: boolean;
    readonly extensions: Record<string, string>;
    readonly filenames?: Record<string, string>;
    readonly serverGates?: Record<string, readonly string[]>;
    readonly servers: readonly string[];
    readonly serversFromConfig: boolean;
  }
  const proposals: Proposal[] = [];
  const languageFields = new Set(["extensions", "filenames", "servers"]);
  for (const [name, entry] of Object.entries(raw)) {
    if (!isObject(entry)) {
      issues.push(`language "${name}": must be an object`);
      continue;
    }
    for (const field of Object.keys(entry)) {
      if (!languageFields.has(field)) {
        issues.push(`language "${name}": unknown field "${field}"`);
      }
    }
    const builtin = languages.get(name);
    const extensions =
      entry.extensions === undefined
        ? builtin?.extensions
        : fileTypes(name, "extensions", entry.extensions, builtin?.extensions);
    const filenames =
      entry.filenames === undefined
        ? builtin?.filenames
        : fileTypes(name, "filenames", entry.filenames, builtin?.filenames);
    if (
      (entry.extensions !== undefined && extensions === undefined) ||
      (entry.filenames !== undefined && filenames === undefined)
    ) {
      continue;
    }
    if (
      builtin === undefined &&
      Object.keys(extensions ?? {}).length === 0 &&
      Object.keys(filenames ?? {}).length === 0
    ) {
      issues.push(`language "${name}": declares no file types`);
      continue;
    }
    const configured = entry.servers === undefined ? undefined : serverList(name, entry.servers);
    if (entry.servers !== undefined && configured === undefined) {
      continue;
    }
    const servers =
      configured?.servers ?? (builtin === undefined ? undefined : [...builtin.servers]);
    if (builtin === undefined && (servers === undefined || servers.length === 0)) {
      issues.push(`language "${name}": declares no servers`);
      continue;
    }
    proposals.push({
      extensions: extensions ?? {},
      ...(filenames === undefined || Object.keys(filenames).length === 0 ? {} : { filenames }),
      name,
      override: builtin !== undefined,
      ...(configured === undefined || Object.keys(configured.gates).length === 0
        ? {}
        : { serverGates: configured.gates }),
      servers: servers ?? [],
      // Only a declared list is a choice; an omitted one inherits the built-in and stays gated.
      serversFromConfig: entry.servers !== undefined,
    });
  }

  // Pass 2: reconcile file-type claims against the FINAL table, not declaration order. A committed
  // Override replaces its built-in wholesale, so the built-in's dropped file types are genuinely
  // Free; overrides claim before new languages, so a kept built-in type still beats a new claimant
  // Regardless of where each appears in the config.
  const overridden = new Set(
    proposals.filter((proposal) => proposal.override).map((proposal) => proposal.name),
  );
  const claimedExtensions = new Map<string, string>();
  const claimedFilenames = new Map<string, string>();
  for (const [name, language] of languages) {
    if (overridden.has(name)) {
      continue;
    }
    for (const extension of Object.keys(language.extensions)) {
      claimedExtensions.set(extension, name);
    }
    for (const filename of Object.keys(language.filenames ?? {})) {
      claimedFilenames.set(filename, name);
    }
  }
  const claim = (
    name: string,
    field: "extensions" | "filenames",
    record: Record<string, string>,
    claimed: Map<string, string>,
  ) =>
    Object.fromEntries(
      Object.entries(record).filter(([key]) => {
        const owner = claimed.get(key);
        if (owner !== undefined && owner !== name) {
          issues.push(`language "${name}": ${field} entry "${key}" already belongs to "${owner}"`);
          return false;
        }
        claimed.set(key, name);
        return true;
      }),
    );
  const ordered = [
    ...proposals.filter((proposal) => proposal.override),
    ...proposals.filter((proposal) => !proposal.override),
  ];
  for (const proposal of ordered) {
    const extensions = claim(proposal.name, "extensions", proposal.extensions, claimedExtensions);
    const filenames =
      proposal.filenames === undefined
        ? undefined
        : claim(proposal.name, "filenames", proposal.filenames, claimedFilenames);
    resolvedLanguages[proposal.name] = {
      extensions,
      ...(filenames === undefined || Object.keys(filenames).length === 0 ? {} : { filenames }),
      ...(proposal.serverGates === undefined ? {} : { serverGates: proposal.serverGates }),
      servers: proposal.servers,
      ...(proposal.serversFromConfig ? { serversFromConfig: true } : {}),
    };
  }

  return { issues, languages: resolvedLanguages, servers: resolvedServers };
}

// Exact filename beats extension; the extension comes from the basename so a dotted directory
// Never reads as one. The language's name comes back with it, because a config gate is keyed by the
// (language, server) pair it was written for, not by the server alone.
function fileType(path: string) {
  const base = path.slice(path.lastIndexOf("/") + 1);
  for (const [name, language] of languages) {
    const languageId = language.filenames?.[base];
    if (languageId !== undefined) {
      return { language, languageId, name };
    }
  }
  const dot = base.lastIndexOf(".");
  if (dot === -1) {
    return undefined;
  }
  const extension = base.slice(dot + 1);
  for (const [name, language] of languages) {
    const languageId = language.extensions[extension];
    if (languageId !== undefined) {
      return { language, languageId, name };
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

// A config gate belongs to the (language, server) pair the user wrote it for, never to the server
// Alone: the cache dir (`cachedBinaryPath`) and the server pool both key by the server name, so a
// Per-language copy of a server would mean a second download and a second process against the same
// Repo (one Biome for `.ts`, another for `.css`). The language's edge to a server is the honest
// Place for it anyway.
function gateKey(language: string, server: string) {
  return `${language} ${server}`;
}

export interface ServerGates {
  /** Built-in servers whose own `detect` accepts this repo: stet's guess. */
  readonly builtin: ReadonlySet<string>;
  /** `when` paths from the user's config, resolved per (language, server): the user's own rule. */
  readonly configured: ReadonlyMap<string, boolean>;
}

/**
 * Every repo gate resolved for one repo. Evaluate once per run and reuse across files: a gate stats
 * the filesystem, so re-checking it per file per snapshot emission would re-stat the same config
 * repeatedly for an invariant result.
 */
export function activeServerGates(repoRoot: string): ServerGates {
  const configured = new Map<string, boolean>();
  for (const [name, language] of languages) {
    for (const [server, paths] of Object.entries(language.serverGates ?? {})) {
      configured.set(
        gateKey(name, server),
        paths.some((path) => existsSync(join(repoRoot, path))),
      );
    }
  }
  return {
    builtin: new Set(
      Object.keys(registry).filter((server) => registry[server]?.detect?.(repoRoot) ?? true),
    ),
    configured,
  };
}

/**
 * The servers this repo actually runs for the file, given the gates resolved once
 * (`activeServerGates`). The one place a gate is applied, so diagnostics and intel can never
 * disagree about which servers a repo opted into.
 */
export function activeServers(path: string, gates: ServerGates): string[] {
  const type = fileType(path);
  if (type === undefined) {
    return [];
  }
  return type.language.servers.filter((server) => {
    if (registry[server] === undefined) {
      return false;
    }
    // Your `when`, if you wrote one. Otherwise a server you named simply runs: a config `servers`
    // List states what to run, and `detect` exists only to guess that, so the guess must not
    // Overrule it. Otherwise it is stet guessing, and the built-in gate decides.
    return (
      gates.configured.get(gateKey(type.name, server)) ??
      (type.language.serversFromConfig === true || gates.builtin.has(server))
    );
  });
}

/** The file's servers this repo runs, gates evaluated for `repoRoot`. */
export function activeServersForPath(path: string, repoRoot: string): string[] {
  return activeServers(path, activeServerGates(repoRoot));
}

/**
 * The file's active servers that statically declare they can answer `capability`, in declared
 * order. Gated on the repo the same way diagnostics are: a server the repo turned off (a Python
 * repo's unused type checker) must not be selected for intel either, or intel would acquire, and
 * provision, a server the repo never opted into.
 */
export function serversProviding(path: string, capability: Capability, repoRoot: string): string[] {
  return activeServersForPath(path, repoRoot).filter((server) =>
    registry[server]?.provides.includes(capability),
  );
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
          // Workspace caps alongside.
          workspace: { diagnostics: { refreshSupport: true }, ...config?.workspaceCapabilities },
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
