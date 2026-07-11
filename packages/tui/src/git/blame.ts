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

/** Blame's sentinel sha for a working-tree line that is not yet committed. */
const UNCOMMITTED_SHA = "0000000000000000000000000000000000000000";

export function blameArgs(path: string, rev?: string) {
  return ["git", "blame", "--porcelain", ...(rev === undefined ? [] : [rev]), "--", path];
}

// `--porcelain` opens each line entry with `<sha> <orig> <final> [<count>]`, emits the
// Extended headers (author/author-time/summary/...) only on a sha's first appearance, and
// Closes the entry with a TAB-prefixed content line. So we carry each sha's metadata in a
// Map and resolve every line (first or repeat) against it, keying on the final line number.
// The all-zero sha marks an uncommitted working-tree line.
export function parseBlamePorcelain(stdout: string): BlameLine[] {
  const meta = new Map<string, { author: string; authorTime: number; summary: string }>();
  const lines: BlameLine[] = [];
  let sha: string | undefined;
  let lineNumber = 0;
  for (const record of stdout.split("\n")) {
    const header = /^(?<sha>[0-9a-f]{40}) \d+ (?<final>\d+)/.exec(record);
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
        uncommitted: sha === UNCOMMITTED_SHA,
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
