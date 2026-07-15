import { bundledLanguagesInfo } from "shiki";

import { parseWhen } from "@/diagnostics/when";

import type {
  FileAssociation,
  FileSupportRegistry,
  LanguageProfile,
  ServerCandidate,
  ServerEntry,
} from "./model";
import { defaultFileSupportRegistry } from "./registry";

type MutableFileAssociation = {
  -readonly [Key in keyof FileAssociation]: FileAssociation[Key];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const syntaxIds = new Set(["text"]);
for (const language of bundledLanguagesInfo) {
  syntaxIds.add(language.id);
  for (const alias of language.aliases ?? []) {
    syntaxIds.add(alias);
  }
}

const fileFields = new Set([
  "caseSensitive",
  "dotfiles",
  "extensions",
  "filenames",
  "globs",
  "icon",
  "language",
  "syntax",
]);
const languageFields = new Set(["languageId", "servers"]);

function stringList(
  owner: string,
  field: "extensions" | "filenames" | "globs",
  value: unknown,
  issues: string[],
) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || item === "")
  ) {
    issues.push(`file "${owner}": ${field} must be a non-empty array of non-empty strings`);
    return undefined;
  }
  const items = value.filter((item): item is string => typeof item === "string");
  if (
    field === "extensions" &&
    items.some((item) => item.startsWith(".") || item.includes("/") || item.includes("\\"))
  ) {
    issues.push(`file "${owner}": extensions must be bare suffixes without a leading dot`);
    return undefined;
  }
  if (field === "filenames" && items.some((item) => item.includes("/") || item.includes("\\"))) {
    issues.push(`file "${owner}": filenames must be basenames, not paths`);
    return undefined;
  }
  if (field === "globs") {
    try {
      for (const pattern of items) {
        const matcher = new Bun.Glob(pattern);
        void matcher;
      }
    } catch {
      issues.push(`file "${owner}": globs contains an invalid pattern`);
      return undefined;
    }
  }
  return items;
}

function parseCandidate(
  owner: string,
  value: unknown,
  serverNames: ReadonlySet<string>,
  issues: string[],
): ServerCandidate | undefined {
  if (typeof value === "string") {
    if (serverNames.has(value)) {
      return value;
    }
    issues.push(`language "${owner}": unknown server "${value}"`);
    return undefined;
  }
  if (!isRecord(value) || typeof value.server !== "string" || value.server === "") {
    issues.push(`language "${owner}": a server must be a name or { server, when? }`);
    return undefined;
  }
  const unknown = Object.keys(value).filter((field) => field !== "server" && field !== "when");
  if (unknown.length > 0) {
    issues.push(...unknown.map((field) => `language "${owner}": unknown server field "${field}"`));
    return undefined;
  }
  if (!serverNames.has(value.server)) {
    issues.push(`language "${owner}": unknown server "${value.server}"`);
    return undefined;
  }
  if (value.when === undefined) {
    return { server: value.server };
  }
  const parsed = parseWhen(value.when);
  if (parsed.when === undefined) {
    issues.push(...parsed.issues.map((issue) => `language "${owner}": ${issue}`));
    return undefined;
  }
  return { server: value.server, when: parsed.when };
}

function parseServerEntry(
  owner: string,
  value: unknown,
  serverNames: ReadonlySet<string>,
  issues: string[],
): ServerEntry | undefined {
  if (!isRecord(value) || !("firstOf" in value)) {
    return parseCandidate(owner, value, serverNames, issues);
  }
  if (Object.keys(value).some((field) => field !== "firstOf")) {
    issues.push(`language "${owner}": firstOf accepts no sibling fields`);
    return undefined;
  }
  if (!Array.isArray(value.firstOf) || value.firstOf.length === 0) {
    issues.push(`language "${owner}": firstOf must be a non-empty array`);
    return undefined;
  }
  const candidates: ServerCandidate[] = [];
  for (const candidate of value.firstOf) {
    const parsed = parseCandidate(owner, candidate, serverNames, issues);
    if (parsed === undefined) {
      return undefined;
    }
    candidates.push(parsed);
  }
  return { firstOf: candidates };
}

function hasControlCharacter(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) {
      return true;
    }
  }
  return false;
}

function resolveIcons(
  raw: Record<string, unknown>,
  registry: FileSupportRegistry,
  issues: string[],
) {
  const icons = new Map(registry.icons);
  for (const [name, value] of Object.entries(raw)) {
    if (value === false) {
      icons.delete(name);
    } else if (typeof value === "string" && value !== "" && !hasControlCharacter(value)) {
      icons.set(name, value);
    } else {
      issues.push(`icon "${name}": must be a non-empty glyph string or false`);
    }
  }
  return icons;
}

function resolveLanguages(
  raw: Record<string, unknown>,
  registry: FileSupportRegistry,
  serverNames: ReadonlySet<string>,
  issues: string[],
) {
  const languages = new Map(registry.languages);
  for (const [name, entry] of Object.entries(raw)) {
    if (entry === false) {
      languages.delete(name);
      continue;
    }
    if (!isRecord(entry)) {
      issues.push(`language "${name}": must be an object or false`);
      continue;
    }
    const unknown = Object.keys(entry).filter((field) => !languageFields.has(field));
    if (unknown.length > 0) {
      issues.push(...unknown.map((field) => `language "${name}": unknown field "${field}"`));
      continue;
    }
    const base = languages.get(name);
    const languageId = entry.languageId ?? base?.languageId;
    if (typeof languageId !== "string" || languageId === "") {
      issues.push(`language "${name}": languageId must be a non-empty string`);
      continue;
    }
    let servers = base?.servers;
    if (entry.servers !== undefined) {
      if (!Array.isArray(entry.servers)) {
        issues.push(`language "${name}": servers must be an array`);
        continue;
      }
      const before = issues.length;
      const entries: ServerEntry[] = [];
      for (const server of entry.servers) {
        const parsed = parseServerEntry(name, server, serverNames, issues);
        if (parsed !== undefined) {
          entries.push(parsed);
        }
      }
      if (issues.length > before || entries.length !== entry.servers.length) {
        continue;
      }
      servers = entries;
    }
    if (servers === undefined) {
      issues.push(`language "${name}": a new language requires servers`);
      continue;
    }
    languages.set(name, { languageId, servers } satisfies LanguageProfile);
  }
  return languages;
}

function resolveFiles(
  raw: Record<string, unknown>,
  registry: FileSupportRegistry,
  icons: ReadonlyMap<string, string>,
  languages: ReadonlyMap<string, LanguageProfile>,
  issues: string[],
) {
  const files = new Map(registry.files);
  for (const [name, entry] of Object.entries(raw)) {
    if (entry === false) {
      files.delete(name);
      continue;
    }
    if (!isRecord(entry)) {
      issues.push(`file "${name}": must be an object or false`);
      continue;
    }
    const unknown = Object.keys(entry).filter((field) => !fileFields.has(field));
    if (unknown.length > 0) {
      issues.push(...unknown.map((field) => `file "${name}": unknown field "${field}"`));
      continue;
    }
    const base = files.get(name);
    const candidate: MutableFileAssociation = { ...base };
    let valid = true;
    for (const field of ["extensions", "filenames", "globs"] as const) {
      if (entry[field] !== undefined) {
        const list = stringList(name, field, entry[field], issues);
        if (list === undefined) {
          valid = false;
        } else {
          Object.assign(candidate, { [field]: list });
        }
      }
    }
    for (const field of ["caseSensitive", "dotfiles"] as const) {
      if (entry[field] !== undefined) {
        if (typeof entry[field] !== "boolean") {
          issues.push(`file "${name}": ${field} must be boolean`);
          valid = false;
        } else {
          Object.assign(candidate, { [field]: entry[field] });
        }
      }
    }
    for (const field of ["icon", "language", "syntax"] as const) {
      if (entry[field] !== undefined) {
        const value = entry[field];
        if (value !== false && (typeof value !== "string" || value === "")) {
          issues.push(`file "${name}": ${field} must be a non-empty name or false`);
          valid = false;
        } else {
          Object.assign(candidate, { [field]: value });
        }
      }
    }
    if (!valid) {
      continue;
    }
    if (typeof candidate.icon === "string" && !icons.has(candidate.icon)) {
      issues.push(`file "${name}": unknown icon "${candidate.icon}"; dropping the icon facet`);
      delete candidate.icon;
    }
    if (typeof candidate.language === "string" && !languages.has(candidate.language)) {
      issues.push(
        `file "${name}": unknown language "${candidate.language}"; dropping the language facet`,
      );
      delete candidate.language;
    }
    if (typeof candidate.syntax === "string" && !syntaxIds.has(candidate.syntax)) {
      issues.push(
        `file "${name}": unknown syntax "${candidate.syntax}"; dropping the syntax facet`,
      );
      delete candidate.syntax;
    }
    const selectors =
      (candidate.extensions?.length ?? 0) +
      (candidate.filenames?.length ?? 0) +
      (candidate.globs?.length ?? 0) +
      (candidate.dotfiles === true ? 1 : 0);
    const facets = [candidate.icon, candidate.language, candidate.syntax].filter(
      (value) => value !== undefined,
    ).length;
    if (selectors === 0 || facets === 0) {
      issues.push(`file "${name}": requires at least one selector and one support facet`);
      continue;
    }
    files.delete(name);
    files.set(name, candidate);
  }
  return files;
}

export interface ResolvedFileSupportConfig {
  readonly issues: string[];
  readonly registry: FileSupportRegistry;
}

/** Merge user registries over built-ins in dependency order: icons, languages, then files. */
export function resolveFileSupportConfig(
  raw: {
    readonly files?: Record<string, unknown>;
    readonly icons?: Record<string, unknown>;
    readonly languages?: Record<string, unknown>;
  },
  serverNames: ReadonlySet<string>,
): ResolvedFileSupportConfig {
  const issues: string[] = [];
  const builtins = defaultFileSupportRegistry();
  const icons = resolveIcons(raw.icons ?? {}, builtins, issues);
  const languages = resolveLanguages(raw.languages ?? {}, builtins, serverNames, issues);
  const files = resolveFiles(raw.files ?? {}, builtins, icons, languages, issues);
  return { issues, registry: { files, icons, languages } };
}
