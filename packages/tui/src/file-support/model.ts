import type { When } from "@/diagnostics/when";

export type ServerCandidate = string | { readonly server: string; readonly when?: When };
export type ServerEntry = ServerCandidate | { readonly firstOf: readonly ServerCandidate[] };

export interface LanguageProfile {
  readonly languageId: string;
  readonly servers: readonly ServerEntry[];
}

export interface FileAssociation {
  readonly caseSensitive?: boolean;
  readonly dotfiles?: boolean;
  readonly extensions?: readonly string[];
  readonly filenames?: readonly string[];
  readonly globs?: readonly string[];
  readonly icon?: string | false;
  readonly language?: string | false;
  readonly syntax?: string | false;
}

export interface FileSupportRegistry {
  readonly files: ReadonlyMap<string, FileAssociation>;
  readonly icons: ReadonlyMap<string, string>;
  readonly languages: ReadonlyMap<string, LanguageProfile>;
}

export interface ResolvedFileSupport {
  readonly icon: string;
  readonly language?: LanguageProfile;
  readonly syntax: string;
}
