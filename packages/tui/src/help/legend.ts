import type { ChangeKind, StageState } from "@/git/model";
import type { Theme } from "@/theme/tokens";
import { kindLetter } from "@/ui-helpers";

// The `Record`s make a new enum member a compile error until it earns a meaning, so the legend
// Cannot silently fall behind a mark the tree starts drawing. The `*_ORDER` arrays carry display
// Order separately from the alphabetical keys.
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

/**
 * The `?` overlay's marks view, the counterpart to `keyHelpGroups()`. Every glyph is read from the
 * same source the app renders with (`kindLetter`), so a mark and its explanation cannot drift
 * apart. A `color` accessor is optional: the change letters read neutral, since their color in the
 * tree is the separate stage axis.
 */
export const legendGroups = (): {
  entries: {
    color?: (colors: Theme) => string;
    glyph: string;
    meaning: string;
  }[];
  heading: string;
}[] => [
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
    // The `●` matches the mark `RecencyDot` draws; a lone decorative dot, not an enum, so it
    // Stays a literal rather than earning its own shared constant.
    entries: [
      {
        color: (colors: Theme) => colors.recency.fresh,
        glyph: "●",
        meaning: "recently changed",
      },
    ],
    heading: "recency",
  },
];
