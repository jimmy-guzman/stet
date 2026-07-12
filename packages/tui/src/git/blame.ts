export interface BlameLine {
  /** 1-based line number in the working-tree file. */
  line: number;
  sha: string;
  /** The line is not yet in any commit (blame's all-zero sha). */
  uncommitted: boolean;
  author: string;
  /** Author date in unix seconds. */
  authorTime: number;
  summary: string;
}

export function blameArgs(path: string, rev?: string) {
  return ["git", "blame", "--porcelain", ...(rev === undefined ? [] : [rev]), "--", path];
}

/**
 * Blame content piped on stdin as this path's working copy, so a side with no revision (the index)
 * is attributed with line numbers that match the shown rows.
 */
export function blameContentsArgs(path: string) {
  return ["git", "blame", "--porcelain", "--contents=-", "--", path];
}

/**
 * Each sha's extended headers (author/author-time/summary) appear only on its first line entry, so
 * metadata is carried in a map and resolved for every line by final line number. The all-zero sha
 * (40 hex in a SHA-1 repo, 64 in a SHA-256 one) marks an uncommitted working-tree line.
 */
export function parseBlamePorcelain(stdout: string): BlameLine[] {
  const meta = new Map<string, { author: string; authorTime: number; summary: string }>();
  const lines: BlameLine[] = [];
  let sha: string | undefined;
  let lineNumber = 0;
  for (const record of stdout.split("\n")) {
    const header = /^(?<sha>[0-9a-f]{40,64}) \d+ (?<final>\d+)/.exec(record);
    if (header?.groups !== undefined) {
      sha = header.groups.sha;
      lineNumber = Number.parseInt(header.groups.final ?? "", 10);
      continue;
    }
    if (sha === undefined) {
      continue;
    }
    if (record.startsWith("\t")) {
      const info = meta.get(sha);
      lines.push({
        author: info?.author ?? "",
        authorTime: info?.authorTime ?? 0,
        line: lineNumber,
        sha,
        summary: info?.summary ?? "",
        uncommitted: /^0+$/.test(sha),
      });
      continue;
    }
    const entry = meta.get(sha) ?? { author: "", authorTime: 0, summary: "" };
    if (record.startsWith("author ")) {
      entry.author = record.slice("author ".length);
    } else if (record.startsWith("author-time ")) {
      entry.authorTime = Number.parseInt(record.slice("author-time ".length), 10);
    } else if (record.startsWith("summary ")) {
      entry.summary = record.slice("summary ".length);
    }
    meta.set(sha, entry);
  }
  return lines;
}
