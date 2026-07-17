import { provenanceGlyph } from "@/components/provenance";
import type { ChangeKind } from "@/git/model";
import type { Provenance } from "@/git/provenance";
import { levelGlyph } from "@/log/levels";
import type { LogLevel } from "@/log/levels";
import { truncate, truncateLeft } from "@/utils/text";

export const STATUS_BAR_PADDING = 1;

const ACTIVITY_LEAD_CELLS = Bun.stringWidth("● ");

export interface StatusBarActivity {
  at: number;
  changeKind: ChangeKind | undefined;
  path: string;
}

export type StatusAlertSource = "diagnostics" | "worktree";

/**
 * An unresolved problem the user has not been told about anywhere else, held until its own source
 * retires it. Only `warning` and `error` qualify: a routine success is already reported by the
 * durable UI it changed, and persisting one here outlives its usefulness (the `checks passed` that
 * sat under a red error count).
 *
 * `source` is what keeps two independent alerts from clobbering each other, so a worktree failure
 * survives a diagnostics run and vice versa.
 */
export interface StatusAlert {
  level: "error" | "warning";
  source: StatusAlertSource;
  text: string;
}

/**
 * Raised alerts, oldest first. Ordered rather than keyed because the order carries the meaning:
 * with one row to show and no way to rank a worktree failure against a diagnostics one, the newest
 * wins, being the problem the user just provoked.
 */
export type StatusAlerts = readonly StatusAlert[];

/** Replaces any alert from the same source and moves it to the newest position. */
export function raiseAlert(alerts: StatusAlerts, alert: StatusAlert): StatusAlerts {
  return [...alerts.filter((current) => current.source !== alert.source), alert];
}

/** Retires one source's alert, leaving every other source's untouched. */
export function clearAlertSource(alerts: StatusAlerts, source: StatusAlertSource): StatusAlerts {
  return alerts.filter((alert) => alert.source !== source);
}

export function latestAlert(alerts: StatusAlerts) {
  return alerts.at(-1);
}

interface StatusBarMessage {
  category:
    | "notification"
    | "foreground-progress"
    | "contextual-inspection"
    | "persistent-alert"
    | "background-progress";
  kind: "message";
  level: LogLevel;
  message: string;
}

interface StatusBarProvenance {
  band: Provenance;
  category: "contextual-inspection";
  kind: "provenance";
  text: string;
}

interface StatusBarAmbient {
  activity: StatusBarActivity;
  category: "ambient";
  kind: "ambient";
}

interface StatusBarGuidance {
  category: "guidance";
  kind: "guidance";
  text: string;
}

export type StatusBarModel =
  | StatusBarMessage
  | StatusBarProvenance
  | StatusBarAmbient
  | StatusBarGuidance;

export interface StatusBarModelInput {
  activity: StatusBarActivity | undefined;
  alert: StatusAlert | undefined;
  backgroundProgress: string | undefined;
  contextualFinding: { level: LogLevel; text: string } | undefined;
  foregroundProgress: string | undefined;
  guidance: string;
  notification: { level: LogLevel; text: string } | undefined;
  provenance: { band: Provenance; text: string } | undefined;
  width: number;
}

/**
 * Pick the one thing the status bar says right now.
 *
 * The row is single-tenant by construction: the first tier below with content owns the whole width,
 * so nothing has to be budgeted against a neighbour and no pair of items can disagree about who
 * shrinks. Guidance sits at the bottom and always has content, which is what makes the return total
 * and every tier above it a pure displacement.
 *
 * The order encodes what the user is waiting on, most-acute first. Two placements carry the reason
 * they exist: a persistent alert outranks provenance, so a real problem is never hidden behind the
 * blame inspector; and provenance outranks background progress, because the user turned the rail on
 * deliberately and a routine `running diagnostics…` should not evict what they asked to see.
 *
 * @param input The live signals, already resolved to plain values by `state.statusBarModel`
 * @returns The single item to render, fitted to `width` in terminal cells
 */
export function buildStatusBarModel(input: StatusBarModelInput): StatusBarModel {
  const width = Math.max(0, input.width - STATUS_BAR_PADDING * 2);

  if (input.foregroundProgress !== undefined) {
    return fitMessage("foreground-progress", "info", input.foregroundProgress, width);
  }
  if (input.notification !== undefined) {
    return fitMessage("notification", input.notification.level, input.notification.text, width);
  }
  if (input.contextualFinding !== undefined) {
    return fitMessage(
      "contextual-inspection",
      input.contextualFinding.level,
      input.contextualFinding.text,
      width,
    );
  }
  if (input.alert !== undefined) {
    return fitMessage("persistent-alert", input.alert.level, input.alert.text, width);
  }
  if (input.provenance !== undefined) {
    return {
      band: input.provenance.band,
      category: "contextual-inspection",
      kind: "provenance",
      text: truncate(
        input.provenance.text,
        Math.max(0, width - Bun.stringWidth(`${provenanceGlyph(input.provenance.band)} `)),
      ),
    };
  }
  if (input.backgroundProgress !== undefined) {
    return fitMessage("background-progress", "info", input.backgroundProgress, width);
  }

  const activity = fitActivity(input.activity, width);
  if (activity !== undefined) {
    return { activity, category: "ambient", kind: "ambient" };
  }
  return { category: "guidance", kind: "guidance", text: truncate(input.guidance, width) };
}

function fitMessage(
  category: StatusBarMessage["category"],
  level: LogLevel,
  text: string,
  width: number,
): StatusBarMessage {
  return {
    category,
    kind: "message",
    level,
    message: truncate(text, Math.max(0, width - Bun.stringWidth(`${levelGlyph(level)} `))),
  };
}

/**
 * The path truncates from the left so the filename, the part that differs, survives; a path reduced
 * to the ellipsis alone says nothing a blank row does not, so it yields the row to guidance.
 */
function fitActivity(activity: StatusBarActivity | undefined, width: number) {
  if (activity === undefined) {
    return undefined;
  }
  const path = truncateLeft(activity.path, Math.max(0, width - ACTIVITY_LEAD_CELLS));
  return path === "" || path === "…" ? undefined : { ...activity, path };
}
