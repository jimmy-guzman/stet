import { getFiletypeFromFileName } from "@pierre/diffs";

import { fileNameParts } from "@/utils/file-name";

import { builtinFiles, builtinIcons, builtinLanguages } from "./builtins";
import type { FileAssociation, FileSupportRegistry, ResolvedFileSupport } from "./model";

interface CompiledAssociation {
  readonly association: FileAssociation;
  readonly globs: readonly { readonly fullPath: boolean; readonly matcher: Bun.Glob }[];
  readonly order: number;
}

function freshRegistry() {
  return {
    files: new Map(builtinFiles),
    icons: new Map(builtinIcons),
    languages: new Map(builtinLanguages),
  };
}

const { files, icons, languages } = freshRegistry();

function compileAssociations() {
  return [...files.values()].map((association, order): CompiledAssociation => {
    const normalize = (value: string) =>
      association.caseSensitive === false ? value.toLowerCase() : value;
    return {
      association,
      globs: (association.globs ?? []).map((pattern) => ({
        fullPath: pattern.includes("/"),
        matcher: new Bun.Glob(normalize(pattern)),
      })),
      order,
    };
  });
}

const state = {
  cache: new Map<string, ResolvedFileSupport>(),
  compiled: compileAssociations(),
};

function matchRank(path: string, compiled: CompiledAssociation) {
  const { association } = compiled;
  const parts = fileNameParts(path);
  const normalize = (value: string) =>
    association.caseSensitive === false ? value.toLowerCase() : value;
  const basename = normalize(parts.basename);
  const extension = parts.extension === undefined ? undefined : normalize(parts.extension);
  if ((association.filenames ?? []).some((filename) => normalize(filename) === basename)) {
    return 4;
  }
  if (
    compiled.globs.some(({ fullPath, matcher }) =>
      matcher.match(normalize(fullPath ? path : parts.basename)),
    )
  ) {
    return 3;
  }
  if (
    extension !== undefined &&
    (association.extensions ?? []).some((candidate) => normalize(candidate) === extension)
  ) {
    return 2;
  }
  return association.dotfiles === true && parts.basename.startsWith(".") ? 1 : undefined;
}

function inferredSyntax(path: string) {
  const { basename, extension } = fileNameParts(path);
  return basename.startsWith(".") && extension === undefined
    ? "text"
    : getFiletypeFromFileName(basename);
}

function resolve(path: string): ResolvedFileSupport {
  const matches = state.compiled
    .flatMap((compiled) => {
      const rank = matchRank(path, compiled);
      return rank === undefined ? [] : [{ ...compiled, rank }];
    })
    .toSorted((left, right) => right.rank - left.rank || right.order - left.order);
  const syntax = matches.find(({ association }) => association.syntax !== undefined)?.association
    .syntax;
  const icon = matches.find(({ association }) => association.icon !== undefined)?.association.icon;
  const language = matches.find(({ association }) => association.language !== undefined)
    ?.association.language;
  const languageProfile =
    language === undefined || language === false ? undefined : languages.get(language);
  return {
    icon: icon === undefined || icon === false ? "file" : icon,
    ...(languageProfile === undefined ? {} : { language: languageProfile }),
    syntax: syntax === undefined ? inferredSyntax(path) : syntax === false ? "text" : syntax,
  };
}

/** Resolve all file-support facets through one association cascade. */
export function fileSupportForPath(path: string) {
  const cached = state.cache.get(path);
  if (cached !== undefined) {
    return cached;
  }
  const support = resolve(path);
  state.cache.set(path, support);
  return support;
}

function iconGlyph(name: string) {
  return icons.get(name) ?? icons.get("file") ?? "";
}

function resolvedIcon(name: string) {
  return icons.has(name)
    ? { glyph: iconGlyph(name), name }
    : { glyph: iconGlyph("file"), name: "file" };
}

export function fileIconForPath(path: string) {
  return resolvedIcon(fileSupportForPath(path).icon);
}

export function namedIcon(name: string) {
  return resolvedIcon(name);
}

export function registeredLanguageProfiles() {
  return languages.values();
}

/** Replace the startup registry after config validation and invalidate resolved paths. */
export function registerFileSupport(registry: FileSupportRegistry) {
  files.clear();
  icons.clear();
  languages.clear();
  for (const [name, association] of registry.files) {
    files.set(name, association);
  }
  for (const [name, glyph] of registry.icons) {
    icons.set(name, glyph);
  }
  for (const [name, language] of registry.languages) {
    languages.set(name, language);
  }
  state.compiled = compileAssociations();
  state.cache.clear();
}

export function defaultFileSupportRegistry(): FileSupportRegistry {
  return freshRegistry();
}

export function snapshotFileSupport() {
  return { files: new Map(files), icons: new Map(icons), languages: new Map(languages) };
}

export function restoreFileSupport(snapshot: ReturnType<typeof snapshotFileSupport>) {
  registerFileSupport(snapshot);
}
