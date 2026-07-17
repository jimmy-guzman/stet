import type { ChangeKind } from "@/git/model";
import type { Provenance } from "@/git/provenance";
import { levelGlyph } from "@/log/levels";
import type { LogLevel } from "@/log/levels";
import { truncate, truncateLeft } from "@/utils/text";

export const STATUS_BAR_PADDING = 1;
export const STATUS_BAR_GROUP_GAP = "  ";

const SIDE_GAP_CELLS = 2;
const ACTIVITY_LEAD_CELLS = Bun.stringWidth("● ");

export interface StatusBarHint {
  category: "guidance";
  mode: "generic" | "active";
  text: string;
}

export interface StatusBarActivity {
  at: number;
  changeKind: ChangeKind | undefined;
  path: string;
}

interface StatusBarMessage {
  category: "notification" | "foreground-progress" | "contextual-inspection";
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

export interface StatusBarAmbient {
  activity: StatusBarActivity | undefined;
  category: "background-progress" | "ambient";
  kind: "ambient";
  level: LogLevel | undefined;
  message: string;
}

type StatusBarContent = StatusBarMessage | StatusBarProvenance | StatusBarAmbient;

export type StatusBarModel =
  | { content: StatusBarContent; layout: "full" }
  | { content: StatusBarAmbient | undefined; hint: StatusBarHint; layout: "split" };

export interface StatusBarModelInput {
  activity: StatusBarActivity | undefined;
  backgroundProgress: string | undefined;
  contextualFinding: { level: LogLevel; text: string } | undefined;
  foregroundProgress: string | undefined;
  hint: StatusBarHint;
  notification: { level: LogLevel; text: string } | undefined;
  outcome: { level: LogLevel; text: string } | undefined;
  provenance: { band: Provenance; text: string } | undefined;
  width: number;
}

function innerWidth(width: number) {
  return Math.max(0, width - STATUS_BAR_PADDING * 2);
}

function messageLeadWidth(level: LogLevel | undefined) {
  return level === undefined ? 0 : Bun.stringWidth(`${levelGlyph(level)} `);
}

function fitMessage(content: StatusBarMessage, width: number) {
  return {
    ...content,
    message: truncate(content.message, Math.max(0, width - messageLeadWidth(content.level))),
  };
}

function fitProvenance(content: StatusBarProvenance, width: number) {
  return {
    ...content,
    text: truncate(content.text, Math.max(0, width - ACTIVITY_LEAD_CELLS)),
  };
}

function ambientWidth(content: StatusBarAmbient) {
  const activityWidth =
    content.activity === undefined
      ? 0
      : ACTIVITY_LEAD_CELLS + Bun.stringWidth(content.activity.path);
  const messageWidth =
    content.message === "" ? 0 : messageLeadWidth(content.level) + Bun.stringWidth(content.message);
  const gapWidth =
    activityWidth > 0 && messageWidth > 0 ? Bun.stringWidth(STATUS_BAR_GROUP_GAP) : 0;
  return activityWidth + gapWidth + messageWidth;
}

function fitAmbient(content: StatusBarAmbient, width: number): StatusBarAmbient {
  if (content.message === "") {
    const pathBudget = Math.max(0, width - ACTIVITY_LEAD_CELLS);
    const path =
      content.activity === undefined ? "" : truncateLeft(content.activity.path, pathBudget);
    return {
      ...content,
      activity:
        path === "" || path === "…" || content.activity === undefined
          ? undefined
          : { ...content.activity, path },
    };
  }

  const leadWidth = messageLeadWidth(content.level);
  const messageOnlyBudget = Math.max(0, width - leadWidth);
  const fullMessageWidth = Bun.stringWidth(content.message);
  const activityBudget =
    width -
    leadWidth -
    fullMessageWidth -
    Bun.stringWidth(STATUS_BAR_GROUP_GAP) -
    ACTIVITY_LEAD_CELLS;
  const truncatedActivityPath =
    content.activity === undefined || activityBudget <= 0
      ? ""
      : truncateLeft(content.activity.path, activityBudget);
  const activityPath = truncatedActivityPath === "…" ? "" : truncatedActivityPath;
  const activity =
    activityPath === "" || content.activity === undefined
      ? undefined
      : { ...content.activity, path: activityPath };
  return {
    ...content,
    activity,
    message:
      activity === undefined ? truncate(content.message, messageOnlyBudget) : content.message,
  };
}

function fullMessage(
  category: StatusBarMessage["category"],
  level: LogLevel,
  message: string,
  width: number,
): StatusBarModel {
  return {
    content: fitMessage({ category, kind: "message", level, message }, innerWidth(width)),
    layout: "full",
  };
}

export function buildStatusBarModel(input: StatusBarModelInput): StatusBarModel {
  if (input.foregroundProgress !== undefined) {
    return fullMessage("foreground-progress", "info", input.foregroundProgress, input.width);
  }

  if (input.notification !== undefined) {
    return fullMessage(
      "notification",
      input.notification.level,
      input.notification.text,
      input.width,
    );
  }

  if (input.contextualFinding !== undefined) {
    return fullMessage(
      "contextual-inspection",
      input.contextualFinding.level,
      input.contextualFinding.text,
      input.width,
    );
  }

  const severeOutcome =
    input.outcome?.level === "error" || input.outcome?.level === "warning"
      ? input.outcome
      : undefined;
  const background: Pick<StatusBarAmbient, "category" | "level" | "message"> | undefined =
    severeOutcome !== undefined
      ? {
          category: "ambient",
          level: severeOutcome.level,
          message: severeOutcome.text,
        }
      : input.backgroundProgress === undefined
        ? input.outcome === undefined
          ? undefined
          : {
              category: "ambient",
              level: input.outcome.level,
              message: input.outcome.text,
            }
        : {
            category: "background-progress",
            level: "info",
            message: input.backgroundProgress,
          };
  const severe = severeOutcome !== undefined;

  if (input.provenance !== undefined && !severe) {
    return {
      content: fitProvenance(
        {
          band: input.provenance.band,
          category: "contextual-inspection",
          kind: "provenance",
          text: input.provenance.text,
        },
        innerWidth(input.width),
      ),
      layout: "full",
    };
  }

  if (background === undefined && input.activity === undefined) {
    return { content: undefined, hint: input.hint, layout: "split" };
  }

  const ambient: StatusBarAmbient = {
    activity: input.activity,
    category: background?.category ?? "ambient",
    kind: "ambient",
    level: background?.level,
    message: background?.message ?? "",
  };
  const available = innerWidth(input.width);
  if (severe) {
    return { content: fitAmbient(ambient, available), layout: "full" };
  }

  const splitWidth = Math.max(0, available - Bun.stringWidth(input.hint.text) - SIDE_GAP_CELLS);
  if (input.hint.mode === "generic" && ambientWidth(ambient) > splitWidth) {
    return { content: fitAmbient(ambient, available), layout: "full" };
  }

  const content = fitAmbient(ambient, splitWidth);
  const hasContent =
    (content.activity !== undefined && content.activity.path !== "…") ||
    (content.message !== "" && content.message !== "…");
  return { content: hasContent ? content : undefined, hint: input.hint, layout: "split" };
}
