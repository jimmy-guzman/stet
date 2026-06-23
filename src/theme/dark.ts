import type { Theme } from "./tokens";

// Shared hexes are intentionally repeated across tokens (e.g. the green in
// Diff.addedSign / stage.staged / kind.added / success): each role may diverge
// In another theme, so call sites must not assume they match
export const darkTheme: Theme = {
  accent: { dim: "#8a3a6e", primary: "#ff4fb8" },
  border: { focused: "#ff4fb8", unfocused: "#27272a" },
  diff: {
    addedBg: "#102a1c",
    addedLineNumberBg: "#0d2117",
    addedSign: "#3ddc84",
    lineNumberFg: "#52525b",
    removedBg: "#32131f",
    removedLineNumberBg: "#260f18",
    removedSign: "#ff5c8a",
  },
  find: { matchBg: "#24304d" },
  kind: {
    added: "#3ddc84",
    deleted: "#ff5c8a",
    modified: "#fbbf24",
    renamed: "#c084fc",
    untracked: "#3ddc84",
  },
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
    mixed: "#fb923c",
    staged: "#3ddc84",
    unstaged: "#fbbf24",
    untracked: "#a1a1aa",
  },
  success: "#3ddc84",
  surface: { base: "#09090b", cursor: "#3a1530", panel: "#111113" },
  syntax: {
    comment: "#71717a",
    function: "#67e8f9",
    keyword: "#ff4fb8",
    member: "#93c5fd",
    number: "#fbbf24",
    operator: "#f5a3d7",
    punctuation: "#a1a1aa",
    string: "#86efac",
    tag: "#fda4af",
    type: "#f0abfc",
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
