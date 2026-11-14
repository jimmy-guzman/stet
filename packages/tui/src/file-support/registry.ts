import { getFiletypeFromFileName } from "@pierre/diffs";

import { fileNameParts } from "@/utils/file-name";

import { builtinFiles, builtinIcons } from "./builtins";
import type {
  FileAssociation,
  FileSupportRegistry,
  ResolvedFileSupport,
} from "./model";

interface CompiledAssociation {
  readonly association: FileAssociation;
  readonly globs: readonly {
    readonly fullPath: boolean;
    readonly matcher: Bun.Glob;
  }[];
  readonly order: number;
}

const freshRegistry = () => ({
  files: new Map(builtinFiles),
  icons: new Map(builtinIcons),
});

const { files, icons } = freshRegistry();

const compileAssociations = () =>
  [...files.values()].map((association, order): CompiledAssociation => {
    const normalize = (value: string) =>
      association.caseSensitive === true ? value : value.toLowerCase();
    return {
      association,
      globs: (association.globs ?? []).map((pattern) => ({
        fullPath: pattern.includes("/"),
        matcher: new Bun.Glob(normalize(pattern)),
      })),
      order,
    };
  });

const state = {
  cache: new Map<string, ResolvedFileSupport>(),
  compiled: compileAssociations(),
};

const matchRank = (path: string, compiled: CompiledAssociation) => {
  const { association } = compiled;
  const parts = fileNameParts(path);
  const normalize = (value: string) =>
    association.caseSensitive === true ? value : value.toLowerCase();
  const basename = normalize(parts.basename);
  const extension =
    parts.extension === undefined ? undefined : normalize(parts.extension);
  if (
    (association.filenames ?? []).some(
      (filename) => normalize(filename) === basename
    )
  ) {
    return 4;
  }
  if (
    compiled.globs.some(({ fullPath, matcher }) =>
      matcher.match(normalize(fullPath ? path : parts.basename))
    )
  ) {
    return 3;
  }
  if (
    extension !== undefined &&
    (association.extensions ?? []).some(
      (candidate) => normalize(candidate) === extension
    )
  ) {
    return 2;
  }
  return association.dotfiles === true && parts.basename.startsWith(".")
    ? 1
    : undefined;
};

const inferredSyntax = (path: string) => {
  const { basename, extension } = fileNameParts(path);
  return basename.startsWith(".") && extension === undefined
    ? "text"
    : getFiletypeFromFileName(basename);
};

const resolve = (path: string): ResolvedFileSupport => {
  const matches = state.compiled
    .flatMap((compiled) => {
      const rank = matchRank(path, compiled);
      return rank === undefined ? [] : [{ ...compiled, rank }];
    })
    .toSorted(
      (left, right) => right.rank - left.rank || right.order - left.order
    );
  const syntax = matches.find(
    ({ association }) => association.syntax !== undefined
  )?.association.syntax;
  const icon = matches.find(({ association }) => association.icon !== undefined)
    ?.association.icon;
  return {
    icon: icon === undefined || icon === false ? "file" : icon,
    syntax: syntax === false ? "text" : (syntax ?? inferredSyntax(path)),
  };
};

/** Resolve all file-support facets through one association cascade. */
export const fileSupportForPath = (path: string) => {
  const cached = state.cache.get(path);
  if (cached !== undefined) {
    return cached;
  }
  const support = resolve(path);
  state.cache.set(path, support);
  return support;
};

const iconGlyph = (name: string) => icons.get(name) ?? icons.get("file") ?? "";

const resolvedIcon = (name: string) =>
  icons.has(name)
    ? { glyph: iconGlyph(name), name }
    : { glyph: iconGlyph("file"), name: "file" };

export const fileIconForPath = (path: string) =>
  resolvedIcon(fileSupportForPath(path).icon);

export const namedIcon = (name: string) => resolvedIcon(name);

/** Replace the startup registry after config validation and invalidate resolved paths. */
export const registerFileSupport = (registry: FileSupportRegistry) => {
  files.clear();
  icons.clear();
  for (const [name, association] of registry.files) {
    files.set(name, association);
  }
  for (const [name, glyph] of registry.icons) {
    icons.set(name, glyph);
  }
  state.compiled = compileAssociations();
  state.cache.clear();
};

export const defaultFileSupportRegistry = (): FileSupportRegistry =>
  freshRegistry();
