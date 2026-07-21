import { provenanceGlyph } from "@/components/provenance";
import type { ChangeKind, StageState } from "@/git/model";
import type { Provenance } from "@/git/provenance";
import { levelGlyph } from "@/log/levels";
import type { Theme } from "@/theme/tokens";
import { CHECK_BADGES, kindLetter } from "@/ui-helpers";

// The `Record`s make a new enum member a compile error until it earns a meaning, so the legend
// Cannot silently fall behind a mark the tree or the rail starts drawing. The `*_ORDER` arrays carry
// Display order separately, since the provenance ramp is a timeline rather than alphabetical.
const CHANGE_KIND_MEANINGS: Record<ChangeKind, string> = {
  added: "added",
  deleted: "deleted",
  modified: "modified",
  renamed: "renamed",
  untracked: "untracked",
};
const CHANGE_KIND_ORDER = [
  "modified",
  "added",
  "deleted",
  "renamed",
  "untracked",
] as const satisfies readonly ChangeKind[];

const STAGE_MEANINGS: Record<StageState, string> = {
  mixed: "staged and unstaged",
  staged: "staged",
  unstaged: "unstaged",
  untracked: "untracked",
};
const STAGE_ORDER = [
  "staged",
  "unstaged",
  "mixed",
  "untracked",
] as const satisfies readonly StageState[];

const PROVENANCE_MEANINGS: Record<Provenance, string> = {
  branch: "committed on this branch",
  changed: "changed since the file began",
  initial: "original to the file",
  session: "committed this session",
  uncommitted: "uncommitted",
};
const PROVENANCE_ORDER = [
  "uncommitted",
  "session",
  "branch",
  "changed",
  "initial",
] as const satisfies readonly Provenance[];

const SEVERITY_ORDER = ["error", "warning", "info"] as const;
const CHECK_ORDER = [
  "pending",
  "failed",
  "clean",
  "unavailable",
] as const satisfies readonly (keyof typeof CHECK_BADGES)[];

/**
 * The `?` overlay's marks view, the counterpart to `keyHelpGroups()`. Every glyph is read from the
 * same source the app renders with (`kindLetter`, `levelGlyph`, `provenanceGlyph`, `CHECK_BADGES`),
 * so a mark and its explanation cannot drift apart. A `color` accessor is optional: the change
 * letters read neutral, since their color in the tree is the separate stage axis.
 */
export function legendGroups(): {
  entries: { color?: (colors: Theme) => string; glyph: string; meaning: string }[];
  heading: string;
}[] {
  return [
    {
      entries: CHANGE_KIND_ORDER.map((kind) => ({
        glyph: kindLetter(kind),
        meaning: CHANGE_KIND_MEANINGS[kind],
      })),
      heading: "changes",
    },
    {
      entries: STAGE_ORDER.map((stage) => ({
        color: (colors: Theme) => colors.stage[stage],
        glyph: "█",
        meaning: STAGE_MEANINGS[stage],
      })),
      heading: "stage (colors the change letter)",
    },
    {
      entries: [
        ...SEVERITY_ORDER.map((level) => ({
          color: (colors: Theme) => colors.severity[level],
          glyph: levelGlyph(level),
          meaning: level,
        })),
        ...CHECK_ORDER.map((state) => ({
          color: CHECK_BADGES[state].color,
          glyph: CHECK_BADGES[state].glyph,
          meaning: CHECK_BADGES[state].meaning,
        })),
      ],
      heading: "diagnostics",
    },
    {
      // The `●` matches the mark `RecencyDot` draws; a lone decorative dot, not an enum, so it
      // Stays a literal rather than earning its own shared constant.
      entries: [
        { color: (colors: Theme) => colors.recency.fresh, glyph: "●", meaning: "recently changed" },
      ],
      heading: "recency",
    },
    {
      entries: PROVENANCE_ORDER.map((band) => ({
        color: (colors: Theme) => colors.provenance[band],
        glyph: provenanceGlyph(band),
        meaning: PROVENANCE_MEANINGS[band],
      })),
      heading: "provenance rail (a)",
    },
  ];
}
