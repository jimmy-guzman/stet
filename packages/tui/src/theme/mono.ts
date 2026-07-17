import type { Theme } from "./tokens";

// Answers "does the user want a monochrome palette", deliberately not
// Bun.enableANSIColors: that getter folds in TTY detection plus Bun's own
// NO_COLOR resolution, which was measured (real TTY, piped, and unpiped) to
// Treat NO_COLOR=0 and NO_COLOR=false as unset, which no-color.org does not:
// The spec disables color whenever NO_COLOR is present and non-empty,
// Regardless of its value. FORCE_COLOR, when present at all, decides outright
// (only "0"/"false" mean off, matching the supports-color convention every
// FORCE_COLOR-aware tool follows); otherwise NO_COLOR wins whenever it is set
// To anything but the empty string.
export function prefersMonochrome(env: Record<string, string | undefined>) {
  if (env.FORCE_COLOR !== undefined) {
    return env.FORCE_COLOR === "0" || env.FORCE_COLOR === "false";
  }
  return env.NO_COLOR !== undefined && env.NO_COLOR !== "";
}

// The NO_COLOR pair: every token is a pure grey (r = g = b), so no hue ever
// Carries meaning; ordering signals (recency, provenance, severity, stage) keep
// Their ramps as brightness. `icon` is empty so every glyph falls back to
// `text.muted`, and `syntax` greys feed the Shiki theme, so code highlighting
// Degrades to weight and brightness. Selected automatically when the terminal
// Reports colors off (see `main.tsx`), and listed in the `t` switcher like any
// Built-in.
export const monoDarkTheme: Theme = {
  accent: { primary: "#e9e9e9" },
  border: { focused: "#e9e9e9", unfocused: "#2c2c2c" },
  caret: { wordBg: "#4a4a4a" },
  diff: {
    addedBg: "#262626",
    addedSign: "#d6d6d6",
    lineNumberFg: "#515151",
    removedBg: "#1f1f1f",
    removedSign: "#8a8a8a",
  },
  find: { matchBg: "#3f3f3f" },
  icon: {},
  kind: {
    added: "#d6d6d6",
    deleted: "#8a8a8a",
    modified: "#b6b6b6",
    renamed: "#a2a2a2",
    untracked: "#c8c8c8",
  },
  provenance: {
    branch: "#999999",
    changed: "#7b7b7b",
    initial: "#5c5c5c",
    session: "#b8b8b8",
    uncommitted: "#d6d6d6",
  },
  recency: { aged: "#616161", fresh: "#e9e9e9" },
  scrollbar: { thumb: "#515151" },
  severity: {
    error: "#e9e9e9",
    info: "#8a8a8a",
    warning: "#b6b6b6",
  },
  stage: {
    mixed: "#c4c4c4",
    staged: "#d6d6d6",
    unstaged: "#a2a2a2",
    untracked: "#7e7e7e",
  },
  success: "#d6d6d6",
  surface: { base: "#191919", cursor: "#2c2c2c", panel: "#101010", scrim: "#000000" },
  syntax: {
    comment: "#707070",
    function: "#e0e0e0",
    keyword: "#d0d0d0",
    keywordControl: "#bcbcbc",
    keywordImport: "#c6c6c6",
    member: "#b0b0b0",
    number: "#cacaca",
    operator: "#9a9a9a",
    punctuation: "#7e7e7e",
    string: "#a6a6a6",
    tag: "#b4b4b4",
    type: "#dcdcdc",
  },
  text: {
    faint: "#5c5c5c",
    muted: "#848484",
    primary: "#e9e9e9",
    secondary: "#b6b6b6",
    selected: "#e9e9e9",
    strong: "#d6d6d6",
  },
};

export const monoLightTheme: Theme = {
  accent: { primary: "#2a2a2a" },
  border: { focused: "#2a2a2a", unfocused: "#bbbbbb" },
  caret: { wordBg: "#cfcfcf" },
  diff: {
    addedBg: "#ececec",
    addedSign: "#3a3a3a",
    lineNumberFg: "#8d8d8d",
    removedBg: "#e0e0e0",
    removedSign: "#6e6e6e",
  },
  find: { matchBg: "#c9c9c9" },
  icon: {},
  kind: {
    added: "#3a3a3a",
    deleted: "#6e6e6e",
    modified: "#4f4f4f",
    renamed: "#5e5e5e",
    untracked: "#454545",
  },
  provenance: {
    branch: "#636363",
    changed: "#787878",
    initial: "#8d8d8d",
    session: "#4f4f4f",
    uncommitted: "#3a3a3a",
  },
  recency: { aged: "#8d8d8d", fresh: "#2a2a2a" },
  scrollbar: { thumb: "#a2a2a2" },
  severity: {
    error: "#2a2a2a",
    info: "#6e6e6e",
    warning: "#4f4f4f",
  },
  stage: {
    mixed: "#4a4a4a",
    staged: "#3a3a3a",
    unstaged: "#5e5e5e",
    untracked: "#7a7a7a",
  },
  success: "#3a3a3a",
  surface: { base: "#f7f7f7", cursor: "#d5d5d5", panel: "#e6e6e6", scrim: "#1a1a1a" },
  syntax: {
    comment: "#7e7e7e",
    function: "#303030",
    keyword: "#3a3a3a",
    keywordControl: "#4f4f4f",
    keywordImport: "#464646",
    member: "#585858",
    number: "#424242",
    operator: "#6a6a6a",
    punctuation: "#5c5c5c",
    string: "#565656",
    tag: "#606060",
    type: "#343434",
  },
  text: {
    faint: "#8d8d8d",
    muted: "#707070",
    primary: "#2a2a2a",
    secondary: "#4a4a4a",
    selected: "#2a2a2a",
    strong: "#3a3a3a",
  },
};
