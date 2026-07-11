import type { BlameLine } from "./blame";

/**
 * A line's arrival relative to the inspection session: still in the working tree (`uncommitted`),
 * committed since stet launched (`session`), or settled before it (`earlier`). The scrutiny order
 * is exactly this order.
 */
export type Provenance = "uncommitted" | "session" | "earlier";

export function classifyProvenance(line: BlameLine, sessionShas: ReadonlySet<string>): Provenance {
  if (line.uncommitted) {
    return "uncommitted";
  }
  return sessionShas.has(line.sha) ? "session" : "earlier";
}

// The commits reachable from HEAD but not from the session base (HEAD at launch), i.e.
// Everything committed during this inspection session. A blamed line whose sha is in this
// Set arrived this session. `base === HEAD` (no commits since launch) yields an empty set,
// So every committed line reads as `earlier`, which is correct for a working-tree-only run.
export function sessionCommitsArgs(base: string) {
  return ["git", "rev-list", `${base}..HEAD`];
}

export function parseRevList(stdout: string): Set<string> {
  return new Set(stdout.split("\n").filter((sha) => sha !== ""));
}
