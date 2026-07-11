import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { lstat, readFile, readlink } from "node:fs/promises";

import { imageMeta } from "./image-meta";
import type { ImageMeta } from "./image-meta";

export type FileContent =
  | { kind: "text"; content: string; lineCount: number; truncated: boolean }
  | { kind: "binary"; bytes: number; image?: ImageMeta }
  | { kind: "missing" }
  | { kind: "too-large"; bytes: number };

const MAX_FILE_BYTES = 1_000_000;
export const MAX_FILE_LINES = 5000;

export interface LoadFileContentOptions {
  full: boolean;
  gitSpec?: string;
}

// Local-file reads only; the File service intercepts the gitSpec (git show) path
// And routes it through the Process service for interruptibility.
export function loadFileContent(
  repoRoot: string,
  path: string,
  options: { full: boolean },
): FileContent {
  const absolutePath = `${repoRoot}/${path}`;
  let size: number;
  try {
    const stat = lstatSync(absolutePath);
    // Git stores a symlink's content as its target path text, never the dereferenced
    // File, so a link to a dir/binary/missing target still reads as its one-line path.
    if (stat.isSymbolicLink()) {
      return textContent(readlinkSync(absolutePath), options.full);
    }
    if (!stat.isFile()) {
      return { bytes: 0, kind: "binary" };
    }
    size = stat.size;
  } catch {
    return { kind: "missing" };
  }

  if (size > MAX_FILE_BYTES && !options.full) {
    return { bytes: size, kind: "too-large" };
  }

  let buffer: Buffer;
  try {
    buffer = readFileSync(absolutePath);
  } catch {
    return { kind: "missing" };
  }

  return classifyFileBytes(buffer, options);
}

// The File service's local-read path: same contract as loadFileContent, but the
// IO awaits instead of blocking, so a burst of reads (search context fetches up
// To 500 matched files per query) never freezes the render loop. Never rejects.
export async function loadFileContentAsync(
  repoRoot: string,
  path: string,
  options: { full: boolean },
): Promise<FileContent> {
  const absolutePath = `${repoRoot}/${path}`;
  try {
    const stat = await lstat(absolutePath);
    // Git stores a symlink's content as its target path text, never the dereferenced
    // File, so a link to a dir/binary/missing target still reads as its one-line path.
    if (stat.isSymbolicLink()) {
      return textContent(await readlink(absolutePath), options.full);
    }
    if (!stat.isFile()) {
      return { bytes: 0, kind: "binary" };
    }
    if (stat.size > MAX_FILE_BYTES && !options.full) {
      return { bytes: stat.size, kind: "too-large" };
    }
    return classifyFileBytes(await readFile(absolutePath), options);
  } catch {
    return { kind: "missing" };
  }
}

// Byte-level binary/size classification shared by the local-read path and the
// File service's git-show path, so deleted binaries are caught before decoding.
export function classifyFileBytes(bytes: Uint8Array, options: { full: boolean }): FileContent {
  if (bytes.byteLength > MAX_FILE_BYTES && !options.full) {
    return { bytes: bytes.byteLength, kind: "too-large" };
  }

  if (bytes.subarray(0, 8000).includes(0)) {
    return { bytes: bytes.byteLength, image: imageMeta(bytes), kind: "binary" };
  }

  return textContent(new TextDecoder().decode(bytes), options.full);
}

export function textContent(content: string, full: boolean): FileContent {
  const normalized = content.endsWith("\n") ? content.slice(0, -1) : content;
  const lines = normalized === "" ? [] : normalized.split("\n");

  if (!full && lines.length > MAX_FILE_LINES) {
    return {
      content: lines.slice(0, MAX_FILE_LINES).join("\n"),
      kind: "text",
      lineCount: lines.length,
      truncated: true,
    };
  }

  return { content: normalized, kind: "text", lineCount: lines.length, truncated: false };
}

export function contentToContextPatch(path: string, content: string) {
  const header = [`--- a/${path}`, `+++ b/${path}`];
  if (content === "") {
    return header.join("\n");
  }

  const lines = content.split("\n");
  return [
    ...header,
    `@@ -1,${lines.length} +1,${lines.length} @@`,
    ...lines.map((line) => ` ${line}`),
  ].join("\n");
}
