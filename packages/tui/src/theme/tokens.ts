import { Predicate } from "effect";

import type { ChangeKind, StageState } from "@/git/model";

/**
 * stet's UI colors, every value a 6-digit lowercase hex string. Never authored by hand: `deriveTheme`
 * computes it from a theme's palette. Typed as full records over the git-status unions, so adding a
 * `ChangeKind` or `StageState` without a matching color is a compile error rather than a silently
 * unthemed status.
 */
export interface Theme {
  accent: { primary: string };
  border: { focused: string; unfocused: string };
  diff: {
    addedBg: string;
    addedSign: string;
    lineNumberFg: string;
    removedBg: string;
    removedSign: string;
  };
  find: { matchBg: string };
  /** Icon colors by icon name; a missing name falls back to `text.muted` at render sites. */
  icon: Record<string, string>;
  kind: Record<ChangeKind, string>;
  /** The recency dot ramps fresh -> aged across an activity's lifetime, then vanishes. */
  recency: { aged: string; fresh: string };
  /**
   * Only the thumb is themed; the track stays transparent so it inherits whatever surface it scrolls
   * over (`rgba.transparent` at the call sites).
   */
  scrollbar: { thumb: string };
  /**
   * Background of selected text in the viewer. A row holding selected text drops the cursor lift from
   * its code, so the two never stack.
   */
  selection: { bg: string };
  severity: { error: string; warning: string };
  stage: Record<StageState, string>;
  success: string;
  /**
   * `scrim` is the alert-dialog backdrop color; resolve.ts blends it with a fixed alpha into
   * `rgba.scrim` to dim (not hide) the app behind a modal.
   */
  /**
   * `hover` marks the list row under the pointer, halfway to the cursor row so the two never read
   * as the same mark.
   */
  surface: {
    base: string;
    cursor: string;
    hover: string;
    panel: string;
    scrim: string;
  };
  text: {
    faint: string;
    muted: string;
    primary: string;
    secondary: string;
    selected: string;
    strong: string;
  };
}

const greyHex = (value: string) =>
  value.slice(1, 3) === value.slice(3, 5) &&
  value.slice(3, 5) === value.slice(5, 7);

/**
 * A theme is monochrome when every color is a pure grey (r = g = b), leaving no hue to carry
 * meaning. Derived from the colors rather than declared, so any all-grey theme (a user's included)
 * gets the hue-free renders, like the viewer's `+`/`-` change bar, without a flag to remember.
 */
export const isMonochromeTheme = (theme: Theme) =>
  Object.values(theme)
    .flatMap((group: Theme[keyof Theme]) =>
      Predicate.isString(group) ? [group] : Object.values(group)
    )
    .every(greyHex);
