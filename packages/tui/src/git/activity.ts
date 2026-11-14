export type ActivityEventKind = "changed" | "appeared" | "removed";

export interface ActivityEvent {
  path: string;
  at: number;
  kind: ActivityEventKind;
}

export interface ActivityLog {
  events: ActivityEvent[];
}

export const RECENT_MS = 30_000;

const MAX_EVENTS = 1000;

export const emptyActivityLog: ActivityLog = { events: [] };

export const recordActivity = (
  log: ActivityLog,
  entries: { path: string; kind: ActivityEventKind }[],
  now: number
): ActivityLog => {
  if (entries.length === 0) {
    return log;
  }

  const events = [
    ...log.events,
    ...entries.map((entry) => ({
      at: now,
      kind: entry.kind,
      path: entry.path,
    })),
  ];
  return {
    events:
      events.length > MAX_EVENTS
        ? events.slice(events.length - MAX_EVENTS)
        : events,
  };
};

export const lastChangedAt = (log: ActivityLog) =>
  new Map(log.events.map((event) => [event.path, event.at]));

/**
 * Max descendant activity per directory (every ancestor gets a key), one pass over the recency map,
 * so a collapsed directory row does an O(1) lookup instead of scanning all entries per row.
 */
export const directoryRecency = (recencyByPath: Map<string, number>) => {
  const byDirectory = new Map<string, number>();
  for (const [path, at] of recencyByPath) {
    const parts = path.split("/");
    let prefix = "";
    for (const part of parts.slice(0, -1)) {
      prefix = prefix === "" ? part : `${prefix}/${part}`;
      const current = byDirectory.get(prefix);
      if (current === undefined || at > current) {
        byDirectory.set(prefix, at);
      }
    }
  }
  return byDirectory;
};

export const latestActivity = (log: ActivityLog): ActivityEvent | undefined =>
  log.events.at(-1);

/**
 * Position of an activity within its decay window, 0 (just now) to 1 (about to Age out), or
 * undefined once it has aged past the window (no dot). Drives the Recency dot's continuous color
 * ramp. `window` is a parameter because a worktree stays "being worked in" for far longer than a
 * file stays "just changed" (see WORKTREE_ACTIVE_MS); a caller that does not pass one gets the
 * file-level RECENT_MS.
 */
export const recencyFraction = (
  at: number | undefined,
  now: number,
  window = RECENT_MS
) => {
  const elapsed = at === undefined ? undefined : now - at;
  return elapsed === undefined || elapsed >= window
    ? undefined
    : Math.max(0, elapsed / window);
};
