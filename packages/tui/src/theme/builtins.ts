import { paletteTheme } from "./palette";
import type { Palette } from "./palette";

/** Builds the 16 slots from the six hues plus greys, repeating each hue as its bright variant. */
const ansi = (colors: {
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightWhite: string;
}): Palette["ansi"] => ({
  black: colors.black,
  blue: colors.blue,
  bright_black: colors.brightBlack,
  bright_blue: colors.blue,
  bright_cyan: colors.cyan,
  bright_green: colors.green,
  bright_magenta: colors.magenta,
  bright_red: colors.red,
  bright_white: colors.brightWhite,
  bright_yellow: colors.yellow,
  cyan: colors.cyan,
  green: colors.green,
  magenta: colors.magenta,
  red: colors.red,
  white: colors.white,
  yellow: colors.yellow,
});

const stetDark = paletteTheme("stet-dark", "dark", {
  accent: "#ffa7d9",
  ansi: ansi({
    black: "#101214",
    blue: "#4fa8e1",
    brightBlack: "#616366",
    brightWhite: "#e9ebee",
    cyan: "#78d0e5",
    green: "#5ab66b",
    magenta: "#b086eb",
    red: "#e76761",
    white: "#b6b7ba",
    yellow: "#dda734",
  }),
  background: "#191b1d",
  foreground: "#e9ebee",
  syntax: {
    comment: "#707274",
    function: "#71c1f7",
    keyword: "#ffa7d9",
    keywordControl: "#eeae7b",
    keywordImport: "#c79ef7",
    member: "#7aacf6",
    number: "#e7d398",
    operator: "#78d0e5",
    punctuation: "#7e8083",
    string: "#91d39f",
    tag: "#b4b9eb",
    type: "#77ddca",
  },
});

const stetLight = paletteTheme("stet-light", "light", {
  accent: "#d446a1",
  ansi: ansi({
    black: "#2a2e33",
    blue: "#0070a6",
    brightBlack: "#8d8f92",
    brightWhite: "#f7f8fa",
    cyan: "#007890",
    green: "#257c3a",
    magenta: "#7449a9",
    red: "#b64340",
    white: "#4a4d51",
    yellow: "#946b00",
  }),
  background: "#f7f8fa",
  foreground: "#2a2e33",
  syntax: {
    comment: "#7e8083",
    function: "#006aa5",
    keyword: "#ab3276",
    keywordControl: "#a36328",
    keywordImport: "#7d4dad",
    member: "#2a61b1",
    number: "#90782a",
    operator: "#007890",
    punctuation: "#5c5e60",
    string: "#287c42",
    tag: "#5e61a1",
    type: "#007565",
  },
});

// Opencode's default theme (`opencode.json` in anomalyco/opencode): its peach primary is the accent.
// The light side's yellow, green, cyan, and blue are darkened from opencode's to clear 3:1 as stet's
// Icon and mark colors on the cursor row.
const opencodeDark = paletteTheme("opencode-dark", "dark", {
  accent: "#fab283",
  ansi: ansi({
    black: "#1e1e1e",
    blue: "#5c9cf5",
    brightBlack: "#606060",
    brightWhite: "#eeeeee",
    cyan: "#56b6c2",
    green: "#7fd88f",
    magenta: "#9d7cd8",
    red: "#e06c75",
    white: "#808080",
    yellow: "#e5c07b",
  }),
  background: "#0a0a0a",
  foreground: "#eeeeee",
  syntax: {
    comment: "#808080",
    function: "#fab283",
    keyword: "#9d7cd8",
    keywordControl: "#9d7cd8",
    keywordImport: "#9d7cd8",
    number: "#f5a742",
    operator: "#56b6c2",
    punctuation: "#eeeeee",
    string: "#7fd88f",
    type: "#e5c07b",
  },
});

const opencodeLight = paletteTheme("opencode-light", "light", {
  accent: "#3b7dd8",
  ansi: ansi({
    black: "#1a1a1a",
    blue: "#2f6bc0",
    brightBlack: "#a0a0a0",
    brightWhite: "#ffffff",
    cyan: "#276f7a",
    green: "#2e7d45",
    magenta: "#7b5bb6",
    red: "#d1383d",
    white: "#8a8a8a",
    yellow: "#8a6716",
  }),
  background: "#ffffff",
  foreground: "#1a1a1a",
  syntax: {
    comment: "#8a8a8a",
    function: "#3b7dd8",
    keyword: "#d68c27",
    keywordControl: "#d68c27",
    keywordImport: "#d68c27",
    number: "#d68c27",
    operator: "#318795",
    punctuation: "#1a1a1a",
    string: "#3d9a57",
    type: "#b0851f",
  },
});

// Cmux's built-in adaptive default (its `GhosttyConfig` fallback palettes), accented in cmux blue.
// Stet's hues are its UI colors, not just terminal text, so each side keeps the readable half of
// Cmux's palette: the bright row on dark, and on light the normal row with yellow, green, and cyan
// Darkened until icons and marks clear 3:1 on the cursor row (cmux's own read at 1.5:1 there).
const cmuxDark = paletteTheme("cmux-dark", "dark", {
  accent: "#0a84ff",
  ansi: ansi({
    black: "#1a1a1a",
    blue: "#0a84ff",
    brightBlack: "#98989d",
    brightWhite: "#ffffff",
    cyan: "#76d6ff",
    green: "#32d74b",
    magenta: "#bf5af2",
    red: "#ff453a",
    white: "#98989d",
    yellow: "#ffd60a",
  }),
  background: "#1e1e1e",
  foreground: "#ffffff",
});

const cmuxLight = paletteTheme("cmux-light", "light", {
  accent: "#0a84ff",
  ansi: ansi({
    black: "#1a1a1a",
    blue: "#0869cb",
    brightBlack: "#6e6e73",
    brightWhite: "#ffffff",
    cyan: "#2a7392",
    green: "#1c7a2b",
    magenta: "#9647bf",
    red: "#cc372e",
    white: "#464646",
    yellow: "#8a6d00",
  }),
  background: "#feffff",
  foreground: "#000000",
});

/**
 * The NO_COLOR pair: every color is a pure grey (r = g = b), so no hue ever carries meaning and
 * derived signals (recency, severity, stage) keep their ramps as brightness. Red is the foreground
 * itself, so an error stays the most prominent mark, ahead of a warning (yellow). Selected automatically
 * when the environment asks for no color (see `main.tsx`), and listed in the `t` switcher like any
 * built-in.
 */
const monoDark = paletteTheme("mono-dark", "dark", {
  accent: "#e9e9e9",
  ansi: ansi({
    black: "#101010",
    blue: "#9a9a9a",
    brightBlack: "#707070",
    brightWhite: "#e9e9e9",
    cyan: "#8e8e8e",
    green: "#c8c8c8",
    magenta: "#b4b4b4",
    red: "#e9e9e9",
    white: "#b6b6b6",
    yellow: "#a6a6a6",
  }),
  background: "#191919",
  foreground: "#e9e9e9",
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
});

const monoLight = paletteTheme("mono-light", "light", {
  accent: "#2a2a2a",
  ansi: ansi({
    black: "#2a2a2a",
    blue: "#5e5e5e",
    brightBlack: "#8d8d8d",
    brightWhite: "#f7f7f7",
    cyan: "#6e6e6e",
    green: "#4a4a4a",
    magenta: "#505050",
    red: "#2a2a2a",
    white: "#4a4a4a",
    yellow: "#6a6a6a",
  }),
  background: "#f7f7f7",
  foreground: "#2a2a2a",
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
});

/** The themes stet ships itself, in the order the switcher lists them. */
export const builtinThemes = [
  stetDark,
  stetLight,
  opencodeDark,
  opencodeLight,
  cmuxDark,
  cmuxLight,
  monoDark,
  monoLight,
];
