import type { Theme } from "./tokens";

// The light counterpart to darkTheme: same intent structure, inverted lightness
// (near-white base, near-black text) with accents deepened to stay legible on
// White. Authored in a calm Geist-light register, ready to tune. Mirrors dark.ts
// Key-for-key so the two themes can never drift (the theme test asserts parity).
export const lightTheme: Theme = {
  accent: { primary: "#cc2b8f" },
  border: { focused: "#c2477f", unfocused: "#d4d4d8" },
  diff: {
    addedBg: "#e3f6ea",
    addedLineNumberBg: "#d4eedd",
    addedSign: "#1f9d57",
    lineNumberFg: "#a1a1aa",
    removedBg: "#fce8ec",
    removedLineNumberBg: "#f7d6de",
    removedSign: "#d23b5e",
  },
  find: { matchBg: "#dbe7fb" },
  kind: {
    added: "#1f9d57",
    deleted: "#d23b5e",
    modified: "#b87503",
    renamed: "#8b3fd6",
    untracked: "#1f9d57",
  },
  recency: { aged: "#cdb8c2", fresh: "#cc4f8c" },
  scrollbar: { thumb: "#c4c4cc", track: "#ededee" },
  severity: {
    error: "#d23b5e",
    errorGutterBg: "#fbe0e6",
    info: "#2563eb",
    infoGutterBg: "#dde8fb",
    warning: "#b87503",
    warningGutterBg: "#fbf0d4",
  },
  stage: {
    mixed: "#c2620f",
    staged: "#1f9d57",
    unstaged: "#b87503",
    untracked: "#71717a",
  },
  success: "#1f9d57",
  surface: { base: "#fcfcfc", cursor: "#f6dcec", panel: "#f4f4f5" },
  syntax: {
    comment: "#8a8a93",
    function: "#0e7490",
    keyword: "#8b3fd6",
    member: "#2563eb",
    number: "#b87503",
    operator: "#b5638f",
    punctuation: "#71717a",
    string: "#1f8a4d",
    tag: "#c4566a",
    type: "#a23bb8",
  },
  text: {
    faint: "#a1a1aa",
    muted: "#71717a",
    primary: "#27272a",
    secondary: "#52525b",
    selected: "#18181b",
    strong: "#3f3f46",
  },
};
