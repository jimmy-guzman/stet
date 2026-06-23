import type { Theme } from "./tokens";

// Shared hexes are intentionally repeated across tokens (e.g. the green in
// Diff.addedSign / stage.staged / kind.added / success): each role may diverge
// In another theme, so call sites must not assume they match
export const darkTheme: Theme = {
  accent: { primary: "#ff4fb8" },
  // Focus border is a whole-pane perimeter, so a muted magenta still reads
  // Unmistakably against the gray unfocused border without shouting; the small
  // Active accents (input cursor, find prefix) keep the saturated accent.primary.
  border: { focused: "#b86089", unfocused: "#27272a" },
  diff: {
    addedBg: "#102a1c",
    addedLineNumberBg: "#0d2117",
    addedSign: "#5cc88f",
    lineNumberFg: "#52525b",
    removedBg: "#32131f",
    removedLineNumberBg: "#260f18",
    removedSign: "#e07089",
  },
  find: { matchBg: "#24304d" },
  kind: {
    added: "#5cc88f",
    deleted: "#e07089",
    modified: "#e0b34f",
    renamed: "#b48fd6",
    untracked: "#5cc88f",
  },
  recency: { aged: "#6a4a5b", fresh: "#d96fa6" },
  scrollbar: { thumb: "#3f3f46", track: "#09090b" },
  severity: {
    error: "#ff5c8a",
    errorGutterBg: "#52141f",
    info: "#6aa9ff",
    infoGutterBg: "#16263f",
    warning: "#fbbf24",
    warningGutterBg: "#4a3a10",
  },
  stage: {
    mixed: "#d98c54",
    staged: "#5cc88f",
    unstaged: "#e0b34f",
    untracked: "#a1a1aa",
  },
  success: "#5cc88f",
  surface: { base: "#09090b", cursor: "#3a1530", panel: "#111113" },
  syntax: {
    comment: "#71717a",
    function: "#82c4d4",
    keyword: "#a78bfa",
    member: "#9fbfe0",
    number: "#e0b34f",
    operator: "#d3a6c4",
    punctuation: "#a1a1aa",
    string: "#9ed1ac",
    tag: "#dca6ad",
    type: "#d4a8d8",
  },
  text: {
    faint: "#52525b",
    muted: "#71717a",
    primary: "#e4e4e7",
    secondary: "#a1a1aa",
    selected: "#ffffff",
    strong: "#d4d4d8",
  },
};
