import type { ChangedFile, StageState } from "./model";

export interface FileNode {
  type: "file";
  id: string;
  name: string;
  path: string;
  tracked: boolean;
  symlink: boolean;
  changed: ChangedFile | undefined;
}

export interface DirectoryNode {
  type: "directory";
  id: string;
  name: string;
  path: string;
  additions: number;
  deletions: number;
  fileCount: number;
  changedCount: number;
  stage: StageState | undefined;
  warnings: string[];
  expanded: boolean;
}

type FileTreeNode = DirectoryNode | FileNode;

export interface FileTreeRow {
  node: FileTreeNode;
  index: number;
  depth: number;
}

export const defaultExpandedDirectories = (changedPaths: string[]) => {
  let expanded = new Set<string>();

  for (const path of changedPaths) {
    expanded = expandAncestorsForPath(expanded, path);
  }

  return expanded;
};

export const expandAncestorsForPath = (expanded: Set<string>, path: string) => {
  const next = new Set(expanded);
  const parts = path.split("/");

  for (let index = 1; index < parts.length; index += 1) {
    next.add(`dir:${parts.slice(0, index).join("/")}`);
  }

  return next;
};
