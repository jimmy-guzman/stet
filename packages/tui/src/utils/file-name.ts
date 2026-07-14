import { parse } from "node:path/posix";

/** Split a Git path into host-independent filename parts without changing its case. */
export function fileNameParts(path: string) {
  const { base: basename, ext, name: stem } = parse(path);
  return { basename, extension: ext === "" ? undefined : ext.slice(1), stem };
}
