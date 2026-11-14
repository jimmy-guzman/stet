export interface FileAssociation {
  readonly caseSensitive?: boolean;
  readonly dotfiles?: boolean;
  readonly extensions?: readonly string[];
  readonly filenames?: readonly string[];
  readonly globs?: readonly string[];
  readonly icon?: string | false;
  readonly syntax?: string | false;
}

export interface FileSupportRegistry {
  readonly files: ReadonlyMap<string, FileAssociation>;
  readonly icons: ReadonlyMap<string, string>;
}

export interface ResolvedFileSupport {
  readonly icon: string;
  readonly syntax: string;
}
