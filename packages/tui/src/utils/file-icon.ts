import { fileIconForPath, namedIcon } from "@/file-support/registry";

export function fileIcon(path: string) {
  return fileIconForPath(path).glyph;
}

export function fileIconModel(path: string) {
  return fileIconForPath(path);
}

export function folderIcon(expanded: boolean) {
  return namedIcon(expanded ? "folder-open" : "folder").glyph;
}

export function folderIconModel(expanded: boolean) {
  return namedIcon(expanded ? "folder-open" : "folder");
}

export function symlinkIcon() {
  return namedIcon("symlink").glyph;
}

export function symlinkIconModel() {
  return namedIcon("symlink");
}
