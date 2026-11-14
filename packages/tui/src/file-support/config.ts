import { Option, Predicate, Schema } from "effect";
import { bundledLanguagesInfo } from "shiki";

import type { FileAssociation, FileSupportRegistry } from "./model";
import { defaultFileSupportRegistry } from "./registry";

type MutableFileAssociation = {
  -readonly [Key in keyof FileAssociation]: FileAssociation[Key];
};

const isJsonObject = Schema.is(Schema.JsonObject);

const decodeName = Schema.decodeUnknownOption(Schema.NonEmptyString);

const decodeNameOrOff = Schema.decodeUnknownOption(
  Schema.Union([Schema.Literal(false), Schema.NonEmptyString])
);

const decodeNames = Schema.decodeUnknownOption(
  Schema.NonEmptyArray(Schema.NonEmptyString)
);

const decodeBoolean = Schema.decodeUnknownOption(Schema.Boolean);

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
  "syntax",
]);

const stringList = (
  owner: string,
  field: "extensions" | "filenames" | "globs",
  value: Schema.Json,
  issues: string[]
): readonly string[] | undefined => {
  const decoded = decodeNames(value);

  if (Option.isNone(decoded)) {
    issues.push(
      `file "${owner}": ${field} must be a non-empty array of non-empty strings`
    );

    return undefined;
  }

  const items = decoded.value;

  if (
    field === "extensions" &&
    items.some(
      (item) =>
        item.startsWith(".") || item.includes("/") || item.includes("\\")
    )
  ) {
    issues.push(
      `file "${owner}": extensions must be bare suffixes without a leading dot`
    );

    return undefined;
  }

  if (
    field === "filenames" &&
    items.some((item) => item.includes("/") || item.includes("\\"))
  ) {
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
};

const hasControlCharacter = (value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.codePointAt(index) ?? 0;

    if (code < 32 || code === 127) {
      return true;
    }
  }

  return false;
};

const resolveIcons = (
  raw: Schema.JsonObject,
  registry: FileSupportRegistry,
  issues: string[]
) => {
  const icons = new Map(registry.icons);

  for (const [name, value] of Object.entries(raw)) {
    if (value === false) {
      icons.delete(name);
      continue;
    }

    const glyph = decodeName(value);

    if (Option.isSome(glyph) && !hasControlCharacter(glyph.value)) {
      icons.set(name, glyph.value);
    } else {
      issues.push(`icon "${name}": must be a non-empty glyph string or false`);
    }
  }

  return icons;
};

/** Copies each present field onto `candidate`, reporting every invalid one; false when any was. */
const assignEntryFields = (
  name: string,
  entry: Schema.JsonObject,
  candidate: MutableFileAssociation,
  issues: string[]
) => {
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
      const flag = decodeBoolean(entry[field]);

      if (Option.isSome(flag)) {
        Object.assign(candidate, { [field]: flag.value });
      } else {
        issues.push(`file "${name}": ${field} must be boolean`);
        valid = false;
      }
    }
  }

  for (const field of ["icon", "syntax"] as const) {
    if (entry[field] !== undefined) {
      const reference = decodeNameOrOff(entry[field]);

      if (Option.isSome(reference)) {
        Object.assign(candidate, { [field]: reference.value });
      } else {
        issues.push(
          `file "${name}": ${field} must be a non-empty name or false`
        );
        valid = false;
      }
    }
  }

  return valid;
};

/** An unknown icon or syntax reference costs only that facet, never the whole association. */
const dropUnknownFacets = (
  name: string,
  candidate: MutableFileAssociation,
  icons: ReadonlyMap<string, string>,
  issues: string[]
) => {
  if (Predicate.isString(candidate.icon) && !icons.has(candidate.icon)) {
    issues.push(
      `file "${name}": unknown icon "${candidate.icon}"; dropping the icon facet`
    );
    delete candidate.icon;
  }

  if (
    Predicate.isString(candidate.syntax) &&
    !syntaxIds.has(candidate.syntax)
  ) {
    issues.push(
      `file "${name}": unknown syntax "${candidate.syntax}"; dropping the syntax facet`
    );
    delete candidate.syntax;
  }
};

const hasSelectorAndFacet = (candidate: MutableFileAssociation) => {
  const selectors =
    (candidate.extensions?.length ?? 0) +
    (candidate.filenames?.length ?? 0) +
    (candidate.globs?.length ?? 0) +
    (candidate.dotfiles === true ? 1 : 0);

  const facets = [candidate.icon, candidate.syntax].filter(
    (value) => value !== undefined
  ).length;

  return selectors > 0 && facets > 0;
};

const resolveFiles = (
  raw: Schema.JsonObject,
  registry: FileSupportRegistry,
  icons: ReadonlyMap<string, string>,
  issues: string[]
) => {
  const files = new Map(registry.files);

  for (const [name, entry] of Object.entries(raw)) {
    if (entry === false) {
      files.delete(name);
      continue;
    }

    if (!isJsonObject(entry)) {
      issues.push(`file "${name}": must be an object or false`);
      continue;
    }

    const unknown = Object.keys(entry).filter(
      (field) => !fileFields.has(field)
    );

    if (unknown.length > 0) {
      issues.push(
        ...unknown.map((field) => `file "${name}": unknown field "${field}"`)
      );
      continue;
    }

    const candidate: MutableFileAssociation = { ...files.get(name) };

    if (!assignEntryFields(name, entry, candidate, issues)) {
      continue;
    }

    dropUnknownFacets(name, candidate, icons, issues);

    if (!hasSelectorAndFacet(candidate)) {
      issues.push(
        `file "${name}": requires at least one selector and one support facet`
      );
      continue;
    }

    files.delete(name);
    files.set(name, candidate);
  }

  return files;
};

export interface ResolvedFileSupportConfig {
  readonly issues: string[];
  readonly registry: FileSupportRegistry;
}

/** Merge user registries over built-ins in dependency order: icons, then files. */
export const resolveFileSupportConfig = (raw: {
  readonly files?: Schema.JsonObject;
  readonly icons?: Schema.JsonObject;
}): ResolvedFileSupportConfig => {
  const issues: string[] = [];
  const builtins = defaultFileSupportRegistry();
  const icons = resolveIcons(raw.icons ?? {}, builtins, issues);
  const files = resolveFiles(raw.files ?? {}, builtins, icons, issues);

  return { issues, registry: { files, icons } };
};
