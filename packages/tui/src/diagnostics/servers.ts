/**
 * Discovers and brings up language servers, pooled one per (language, repo root). Discovery is the
 * hybrid path: a repo-local binary wins over one on PATH (reusing the checker's `resolveBinary`).
 * The pool keeps a server warm across the many poll-driven pulls and releases it once the last
 * reference drops, so a worktree switch transparently swaps to a fresh server for the new root.
 */
import { existsSync, watch } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { Context, Data, Effect, Layer, Queue, RcMap, Stream } from "effect";
import type { Scope } from "effect";

import { resolveBinary } from "./checker";
import { LspProcess } from "./lsp-process";
import type { LspSpawnError } from "./lsp-process";
import { cachedBinaryPath, Provisioner } from "./provision";
import type { ProvisionChannel, ProvisionSpec } from "./provision";
import { LspRequestError } from "./transport";
import type { LspConnection } from "./transport";
import { watchedFileEvent } from "./watched-files";
import type { WatchedFileEvent } from "./watched-files";
import { evaluateWhen, parseWhen } from "./when";
import type { ManifestCache, When } from "./when";

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
   * When set, the server runs only in repos the gate accepts. oxlint/typescript run in every JS/TS
   * repo, but a competing linter like Biome should activate only where the repo opted into it (a
   * `biome.json`), the way an editor's Biome extension does, so it neither runs nor downloads in
   * repos that don't use it (where it does run, it overlaps oxlint and the per-file merge unions
   * both, like any shared file type). Data, not a predicate, like `initializationOptions`: the
   * registry writes the same `when` grammar the config does, so a user's gate and a built-in's are
   * one mechanism, and there is deliberately no code escape hatch (a gate the grammar can't express
   * gets a new condition in `when.ts`, which config then gets for free).
   */
  readonly when?: When;
}

// Adding a language is one `languages` entry (its file types and server order) plus a `registry`
// Entry per new server; the transport, pool, and handshake are language-agnostic. When a server or
// Language changes here, update docs/content/docs/reference/languages.mdx to match (hand-written
// By choice; the table is small and slow-moving). A language lists
// Every server that analyzes it (typescript type-checks the JS/TS family, oxlint lints the same
// Files) and the per-file results merge. A server with a `when` gate runs only in repos it accepts
// (Biome needs a biome config); a language with competing servers lists them in a `firstOf` group,
// Candidates in preference order, and the first whose gate accepts the repo runs (python: ty where
// The repo opted in, else basedpyright, exactly one).
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
  // Answers, so it needs no handshake extras. It is Python's default checker, not its only one:
  // Deliberately ungated, it is the fallback candidate in python's `firstOf` group, running exactly
  // Where ty's gate does not claim the repo.
  "basedpyright": {
    args: ["--stdio"],
    binary: "basedpyright-langserver",
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
    // The gate guarantees a biome config exists, so Biome resolves it on its own and the
    // Transport's null default answers its `workspace/configuration` pull. No handshake needed.
    when: ["biome.json", "biome.jsonc"],
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
  // Astral's Python type checker, run over its LSP (`ty server`). It is the basedpyright alternative,
  // Not an addition: python's `firstOf` group prefers it, so where its gate accepts the repo it runs
  // And basedpyright does not, and the panel shows what the project's own `ty check` shows. Same
  // Cargo-dist release shape as ruff, so it comes through the same sha256-pinned `tar.gz` binary
  // Channel. Its `initialize` result advertises every intel provider stet pulls except
  // `implementation`, hence its absence below; a ty repo reports that key as unsupported rather than
  // Keeping a second type checker alive to answer it.
  "ty": {
    args: ["server"],
    binary: "ty",
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
    // A dedicated ty config is the clearest opt-in, but ty is routinely used with no config at all
    // (`uv add --dev ty`, then `uv run ty check` in CI), so a declared dependency counts too.
    // Without that, the repos this gate exists for would keep seeing basedpyright's findings.
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
/**
 * One server in a language's list, in the grammar the config and the built-in table share. A bare
 * string is the server governed by its own registry `when` (stet's guess, so a built-in list stays
 * repo-gated); `{ server }` is unconditional (a config user named it, so it runs: `detect`-style
 * guessing must never overrule a stated choice); `{ server, when }` is governed by that gate (the
 * way back for a global config over heterogeneous repos); `{ firstOf }` is candidates in preference
 * order, the first whose gate accepts the repo running. The group is how competing servers stay
 * mutually exclusive without negation: python prefers ty (gated) and falls back to basedpyright
 * (ungated), and a third checker later is one insert with its own gate, touching neither.
 *
 * A gate rides on the entry, never on a per-language copy of the server's spec: the cache dir
 * (`cachedBinaryPath`) and the server pool both key by server name, so a copy would mean a second
 * download and a second process against one repo (one Biome for `.ts`, another for `.css`). The
 * same constraint is why `{ server }` takes no options: one pooled process per server and repo
 * cannot hold two languages' options.
 */
type ServerEntry =
  | string
  | { readonly server: string; readonly when?: When }
  | { readonly firstOf: readonly (string | { readonly server: string; readonly when?: When })[] };

interface Language {
  /** Extension (no dot) -> LSP `languageId`. */
  readonly extensions: Record<string, string>;
  /** Exact basename -> LSP `languageId`; wins over the extension match. */
  readonly filenames?: Record<string, string>;
  readonly servers: readonly ServerEntry[];
}

// No built-in declares `filenames` yet; it routes extensionless types (Dockerfile, Makefile) the
// Day a server for one lands, resolving exact-name-then-extension the way the icon and highlighter
// Lookups already do.
const builtinLanguages: Record<string, Language> = {
  css: { extensions: { css: "css" }, servers: ["biome"] },
  graphql: { extensions: { graphql: "graphql" }, servers: ["biome"] },
  json: { extensions: { json: "json", jsonc: "jsonc" }, servers: ["json", "biome"] },
  // The repo's type checker type-checks and answers intel, exactly one of the two candidates: ty
  // Where its gate accepts the repo, else basedpyright, the ungated fallback. ruff lints (always-on,
  // The default Python linter, not a competitor to one). `.pyi` stubs open as python too.
  python: {
    extensions: { py: "python", pyi: "python" },
    servers: [{ firstOf: ["ty", "basedpyright"] }, "ruff"],
  },
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

  const serverFields = new Set([
    "command",
    "firstOf",
    "initializationOptions",
    "server",
    "settings",
    "when",
  ]);

  const parsedWhen = (name: string, value: unknown) => {
    const { issues: whenIssues, when } = parseWhen(value);
    for (const issue of whenIssues) {
      issues.push(`language "${name}": ${issue}`);
    }
    return when;
  };

  // One config entry -> one resolved ServerEntry, or undefined with its problem reported. A bare
  // Name resolves to the unconditional `{ server }` form: the user named it, so it runs, and stet's
  // Registry gate (a guess at intent) must not overrule the statement. Inside a `firstOf` group the
  // Bare name stays the string form instead (registry-gated), because the group's whole meaning is
  // "pick by condition"; an unconditional candidate ends the list as the fallback.
  const serverEntry = (name: string, entry: unknown, inGroup: boolean): ServerEntry | undefined => {
    if (typeof entry === "string") {
      if (registry[entry] === undefined) {
        issues.push(`language "${name}": unknown server "${entry}"`);
        return undefined;
      }
      return inGroup ? entry : { server: entry };
    }
    if (!isObject(entry)) {
      issues.push(
        `language "${name}": a server must be a built-in name, { server }, { command }, or { firstOf }`,
      );
      return undefined;
    }
    for (const field of Object.keys(entry)) {
      if (!serverFields.has(field)) {
        issues.push(`language "${name}": unknown server field "${field}"`);
      }
    }
    if (entry.firstOf !== undefined) {
      if (inGroup) {
        issues.push(`language "${name}": firstOf groups don't nest`);
        return undefined;
      }
      if (Object.keys(entry).length !== 1 || !Array.isArray(entry.firstOf)) {
        issues.push(`language "${name}": firstOf must be the only field, holding an array`);
        return undefined;
      }
      const candidates = entry.firstOf
        .map((candidate) => serverEntry(name, candidate, true))
        .filter(
          (candidate): candidate is string | { server: string; when?: When } =>
            candidate !== undefined && (typeof candidate === "string" || "server" in candidate),
        );
      if (candidates.length === 0) {
        issues.push(`language "${name}": firstOf resolved no candidates`);
        return undefined;
      }
      return { firstOf: candidates };
    }
    if ((entry.server === undefined) === (entry.command === undefined)) {
      issues.push(`language "${name}": a server needs exactly one of "server" or "command"`);
      return undefined;
    }
    const when = entry.when === undefined ? undefined : parsedWhen(name, entry.when);
    if (entry.when !== undefined && when === undefined) {
      return undefined;
    }
    // A built-in, named to attach a gate to it. Options are deliberately not accepted: they would
    // Need a spec of this server's own, but the pool keys per server and repo, so two languages
    // Could never disagree about one server's options. Only the gate is per-entry.
    if (entry.server !== undefined) {
      if (typeof entry.server !== "string" || registry[entry.server] === undefined) {
        issues.push(`language "${name}": unknown server ${JSON.stringify(entry.server)}`);
        return undefined;
      }
      if (entry.initializationOptions !== undefined || entry.settings !== undefined) {
        issues.push(`language "${name}": a built-in server takes only "when"`);
        return undefined;
      }
      return { server: entry.server, ...(when === undefined ? {} : { when }) };
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
      return undefined;
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
    return { server: key, ...(when === undefined ? {} : { when }) };
  };

  const serverList = (name: string, value: unknown) => {
    if (!Array.isArray(value)) {
      issues.push(`language "${name}": servers must be an array`);
      return undefined;
    }
    return value
      .map((entry) => serverEntry(name, entry, false))
      .filter((entry): entry is ServerEntry => entry !== undefined);
  };

  // Pass 1: validate each entry into a proposal, no cross-entry checks yet. Only entries that
  // Survive every validation propose anything, so a skipped entry can never block another's
  // File types.
  interface Proposal {
    readonly name: string;
    readonly override: boolean;
    readonly extensions: Record<string, string>;
    readonly filenames?: Record<string, string>;
    readonly servers: readonly ServerEntry[];
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
    // An omitted list inherits the built-in (strings, so registry gates keep applying); a declared
    // One resolves to entries whose bare names became unconditional `{ server }` forms.
    const servers =
      entry.servers === undefined
        ? builtin === undefined
          ? undefined
          : [...builtin.servers]
        : serverList(name, entry.servers);
    if (entry.servers !== undefined && servers === undefined) {
      continue;
    }
    if (builtin === undefined && (servers === undefined || servers.length === 0)) {
      issues.push(`language "${name}": declares no servers`);
      continue;
    }
    proposals.push({
      extensions: extensions ?? {},
      ...(filenames === undefined || Object.keys(filenames).length === 0 ? {} : { filenames }),
      name,
      override: builtin !== undefined,
      servers: servers ?? [],
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
      servers: proposal.servers,
    };
  }

  return { issues, languages: resolvedLanguages, servers: resolvedServers };
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

// The candidates a group or list entry names, groups flattened, gates ignored.
function entryServers(entry: ServerEntry): string[] {
  if (typeof entry === "string") {
    return [entry];
  }
  if ("firstOf" in entry) {
    return entry.firstOf.flatMap(entryServers);
  }
  return [entry.server];
}

/**
 * The owning language's servers for this file's type, in declared order (groups flattened, gates
 * ignored), unknown keys dropped.
 */
export function serversForPath(path: string): string[] {
  const type = fileType(path);
  return type === undefined
    ? []
    : type.language.servers
        .flatMap(entryServers)
        .filter((server) => registry[server] !== undefined);
}

export interface ServerGates {
  /** Whether each distinct `when` (keyed by its canonical JSON) accepts this repo. */
  readonly accepted: ReadonlyMap<string, boolean>;
}

const whenKey = (when: When) => JSON.stringify(when);

/**
 * Every registered gate resolved for one repo: the registry `when`s plus every per-entry `when` a
 * config language declared. Evaluate once per run and reuse across files: gates stat the filesystem
 * and parse manifests, so re-checking per file per snapshot emission would re-read the same files
 * repeatedly for an invariant result. One `ManifestCache` spans the pass, so ty's two pyproject
 * conditions cost one read.
 */
export function activeServerGates(repoRoot: string): ServerGates {
  const accepted = new Map<string, boolean>();
  const manifests: ManifestCache = new Map();
  const evaluate = (when: When | undefined) => {
    if (when === undefined) {
      return;
    }
    const key = whenKey(when);
    if (!accepted.has(key)) {
      accepted.set(key, evaluateWhen(when, repoRoot, manifests));
    }
  };
  for (const spec of Object.values(registry)) {
    evaluate(spec.when);
  }
  for (const language of languages.values()) {
    for (const entry of language.servers) {
      if (typeof entry === "string") {
        continue;
      }
      for (const candidate of "firstOf" in entry ? entry.firstOf : [entry]) {
        if (typeof candidate !== "string") {
          evaluate(candidate.when);
        }
      }
    }
  }
  return { accepted };
}

/**
 * The servers this repo actually runs for the file, given the gates resolved once
 * (`activeServerGates`). The one place a gate is applied, so diagnostics and intel can never
 * disagree about which servers a repo opted into. A string entry answers to its registry `when`
 * (stet's guess); a `{ server }` entry answers to its own `when` or runs unconditionally (the
 * user's statement, which the guess must not overrule); a `firstOf` group runs its first accepted
 * candidate only, which is what keeps competing servers mutually exclusive.
 */
export function activeServers(path: string, gates: ServerGates): string[] {
  const type = fileType(path);
  if (type === undefined) {
    return [];
  }
  const passes = (when: When | undefined) =>
    when === undefined ? true : (gates.accepted.get(whenKey(when)) ?? false);
  const candidateActive = (candidate: string | { server: string; when?: When }) => {
    const server = typeof candidate === "string" ? candidate : candidate.server;
    if (registry[server] === undefined) {
      return false;
    }
    return passes(typeof candidate === "string" ? registry[server]?.when : candidate.when);
  };
  const active = type.language.servers.flatMap((entry) => {
    if (typeof entry !== "string" && "firstOf" in entry) {
      const winner = entry.firstOf.find(candidateActive);
      return winner === undefined ? [] : entryServers(winner);
    }
    return candidateActive(entry) ? entryServers(entry) : [];
  });
  return [...new Set(active)];
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
    return {
      capabilities: parseCapabilities(result),
      connection,
    } satisfies ServerHandle;
  });
}

// The debounce the whole ecosystem converged on: both the git watcher here and the LSP file watchers
// In Zed and Neovim coalesce a burst into one notification at 100ms.
const BASE_DEBOUNCE_MS = 100;

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
  return Stream.callback<readonly WatchedFileEvent[]>(
    (queue) =>
      Effect.gen(function* watchBase() {
        // Path -> whether it was renamed (appeared/vanished) rather than rewritten in place. A
        // Package install is a *creation* under the search path, and that distinction is what makes
        // Pyright rescan for it rather than merely re-read what it already knew (`watchedFileEvent`).
        const pending = new Map<string, boolean>();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const flush = () => {
          timer = undefined;
          const events = [...pending].map(([name, renamed]) =>
            watchedFileEvent(join(base, name), renamed),
          );
          // Keep the batch if the offer is dropped, and retry: a lost batch here is a dependency
          // Install the server never hears about, which is the bug this whole channel exists to fix.
          if (Queue.offerUnsafe(queue, events)) {
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
            bases.map((base) => baseChanges(base)),
            { concurrency: "unbounded" },
          ),
        ),
        Stream.runForEach((events) => connection.watchedFilesChanged(events)),
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
    /**
     * Tell every live server for this repo about on-disk changes, each filtered against its own
     * registered globs. Broadcast from the pool rather than from a keeper, so a server held only by
     * the intel warm-hold hears about them too.
     */
    readonly notifyWatchedFiles: (
      repoRoot: string,
      events: readonly WatchedFileEvent[],
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

    // The pool key is "<language> <repoRoot>" and a language never contains a space.
    const keysFor = (repoRoot: string) =>
      [...live.keys()].filter((key) => key.endsWith(` ${repoRoot}`));

    const notifyWatchedFiles = (repoRoot: string, events: readonly WatchedFileEvent[]) =>
      Effect.suspend(() =>
        Effect.forEach(
          keysFor(repoRoot),
          (key) => live.get(key)?.connection.watchedFilesChanged(events) ?? Effect.void,
          { discard: true },
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
        return Effect.forEach(keys, (key) => RcMap.invalidate(pool, key), { discard: true });
      });

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

    return { acquire, notifyWatchedFiles, restart };
  }),
);
