import { Schema } from "effect";

import type { ChangeKind, StageState } from "@/git/model";

// Every value is a 6-digit lowercase hex string. `ThemeSchema` is the single
// Source of truth: the `Theme` type is derived from it, and a user-supplied
// Theme (parsed from JSON config) is validated against it. RGBA precomputation
// Happens in resolve.ts.
const Hex = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^#[0-9a-f]{6}$/, {
      message: "expected a 6-digit lowercase hex color, e.g. #1a2b3c",
    }),
  ),
);

// Typed as a full record over the git-status unions, so adding a `ChangeKind` or
// `StageState` without a matching token here is a compile error rather than a
// Silently unthemed status.
const kindTokens: Record<ChangeKind, typeof Hex> = {
  added: Hex,
  deleted: Hex,
  modified: Hex,
  renamed: Hex,
  untracked: Hex,
};

const stageTokens: Record<StageState, typeof Hex> = {
  mixed: Hex,
  staged: Hex,
  unstaged: Hex,
  untracked: Hex,
};

export const ThemeSchema = Schema.Struct({
  accent: Schema.Struct({ primary: Hex }),
  border: Schema.Struct({ focused: Hex, unfocused: Hex }),
  // Background of the word under the in-line caret; reads on top of the cursor-row
  // Highlight, so it is distinct from `surface.cursor` and `find.matchBg`.
  caret: Schema.Struct({ wordBg: Hex }),
  diff: Schema.Struct({
    addedBg: Hex,
    addedSign: Hex,
    lineNumberFg: Hex,
    removedBg: Hex,
    removedSign: Hex,
  }),
  find: Schema.Struct({ matchBg: Hex }),
  /** User-extensible icon colors; missing names fall back to `text.muted` at render sites. */
  icon: Schema.Record(Schema.String, Hex),
  kind: Schema.Struct(kindTokens),
  // The viewer's per-line provenance rail: a five-tier scrutiny timeline as one neutral
  // Brightness ramp, brightest at `uncommitted` fading to the faint neutral at `initial`,
  // So color reinforces the weight ramp (the status bar names the exact tier for the caret).
  // Neutral, not a hue: the rail is read-only inspection, not a warning or a status.
  provenance: Schema.Struct({
    branch: Hex,
    changed: Hex,
    initial: Hex,
    session: Hex,
    uncommitted: Hex,
  }),
  // Recency dot ramps fresh -> aged across an activity's lifetime, then vanishes.
  recency: Schema.Struct({ aged: Hex, fresh: Hex }),
  // Only the thumb is themed; the track stays transparent so it inherits
  // Whatever surface it scrolls over (rgba.transparent at the call sites).
  scrollbar: Schema.Struct({ thumb: Hex }),
  severity: Schema.Struct({ error: Hex, info: Hex, warning: Hex }),
  stage: Schema.Struct(stageTokens),
  success: Hex,
  // `scrim` is the alert-dialog backdrop color; resolve.ts blends it with a fixed
  // Alpha into `rgba.scrim` to dim (not hide) the app behind a modal.
  surface: Schema.Struct({ base: Hex, cursor: Hex, panel: Hex, scrim: Hex }),
  syntax: Schema.Struct({
    comment: Hex,
    function: Hex,
    keyword: Hex,
    keywordControl: Hex,
    keywordImport: Hex,
    member: Hex,
    number: Hex,
    operator: Hex,
    punctuation: Hex,
    string: Hex,
    tag: Hex,
    type: Hex,
  }),
  text: Schema.Struct({
    faint: Hex,
    muted: Hex,
    primary: Hex,
    secondary: Hex,
    selected: Hex,
    strong: Hex,
  }),
});

export type Theme = Schema.Schema.Type<typeof ThemeSchema>;

/**
 * A theme is monochrome when every token is a pure grey (r = g = b), leaving no hue to carry
 * meaning. Derived from the tokens rather than declared, so any all-grey theme (a user's included)
 * gets the hue-free renders, like the viewer's `+`/`-` change bar, without a flag to remember.
 */
export function isMonochromeTheme(theme: Theme) {
  const greyHex = (value: string) =>
    value.slice(1, 3) === value.slice(3, 5) && value.slice(3, 5) === value.slice(5, 7);
  const grey = (node: unknown): boolean =>
    typeof node === "string"
      ? greyHex(node)
      : typeof node === "object" && node !== null && Object.values(node).every(grey);
  return grey(theme);
}
