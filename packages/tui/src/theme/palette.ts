import { lerpHex } from "@/utils/color";

import type { ZedTheme } from "./zed";

/** The 16 terminal colors, in SGR order, as Zed names them (`terminal.ansi.<name>`). */
export const ANSI_NAMES = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "bright_black",
  "bright_red",
  "bright_green",
  "bright_yellow",
  "bright_blue",
  "bright_magenta",
  "bright_cyan",
  "bright_white",
] as const;

type AnsiName = (typeof ANSI_NAMES)[number];

/** Names 16 colors given in SGR order (Ghostty's `palette = N=#hex`, a terminal's OSC 4 reply). */
export const ansiFromSlots = (
  slots: readonly string[]
): Record<AnsiName, string> => {
  const at = (index: number) => slots[index] ?? "#000000";

  return {
    black: at(0),
    blue: at(4),
    bright_black: at(8),
    bright_blue: at(12),
    bright_cyan: at(14),
    bright_green: at(10),
    bright_magenta: at(13),
    bright_red: at(9),
    bright_white: at(15),
    bright_yellow: at(11),
    cyan: at(6),
    green: at(2),
    magenta: at(5),
    red: at(1),
    white: at(7),
    yellow: at(3),
  };
};

type SyntaxRole =
  | "comment"
  | "function"
  | "keyword"
  | "keywordControl"
  | "keywordImport"
  | "member"
  | "number"
  | "operator"
  | "punctuation"
  | "string"
  | "tag"
  | "type";

/**
 * Everything a theme is, the cmux/Ghostty way: a background, a foreground, and the 16 terminal
 * colors. `accent` and `syntax` refine it; without them the accent is magenta and code colors come
 * from the ANSI slots.
 */
export interface Palette {
  background: string;
  foreground: string;
  ansi: Record<AnsiName, string>;
  accent?: string;
  syntax?: Partial<Record<SyntaxRole, string>>;
}

/**
 * Code colors from the terminal palette, as opencode's `system` theme picks them. Punctuation is the
 * foreground eased toward the background rather than an ANSI slot: a light terminal's `white` sits
 * next to its background and would leave braces and commas nearly invisible.
 */
const ansiSyntax = ({
  ansi,
  background,
  foreground,
}: Palette): Record<SyntaxRole, string> => ({
  comment: ansi.bright_black,
  function: ansi.blue,
  keyword: ansi.magenta,
  keywordControl: ansi.magenta,
  keywordImport: ansi.magenta,
  member: ansi.cyan,
  number: ansi.yellow,
  operator: ansi.cyan,
  punctuation: lerpHex(background, foreground, 0.7),
  string: ansi.green,
  tag: ansi.red,
  type: ansi.yellow,
});

/**
 * A Zed theme (what the highlighter and `deriveTheme` read) from a palette. Zed scopes inherit from
 * their nearest configured parent, so `keyword.declaration` takes `keyword` and
 * `punctuation.bracket` takes `punctuation` without listing them.
 */
export const paletteTheme = (
  name: string,
  appearance: "dark" | "light",
  palette: Palette
): ZedTheme => {
  const syntax = { ...ansiSyntax(palette), ...palette.syntax };

  return {
    appearance,
    name,
    style: {
      "editor.background": palette.background,
      "editor.foreground": palette.foreground,
      ...Object.fromEntries(
        ANSI_NAMES.map((slot) => [`terminal.ansi.${slot}`, palette.ansi[slot]])
      ),
      "text.accent": palette.accent ?? palette.ansi.magenta,
      syntax: {
        attribute: syntax.type,
        boolean: syntax.number,
        comment: syntax.comment,
        constant: syntax.number,
        constructor: syntax.type,
        emphasis: palette.foreground,
        function: syntax.function,
        keyword: syntax.keyword,
        "keyword.control": syntax.keywordControl,
        "keyword.import": syntax.keywordImport,
        "keyword.operator": syntax.operator,
        label: syntax.member,
        link_uri: syntax.function,
        namespace: syntax.member,
        number: syntax.number,
        operator: syntax.operator,
        property: syntax.member,
        punctuation: syntax.punctuation,
        string: syntax.string,
        "string.escape": syntax.operator,
        "string.regex": syntax.operator,
        tag: syntax.tag,
        "text.literal": syntax.string,
        title: syntax.keyword,
        type: syntax.type,
        variable: palette.foreground,
      },
    },
  };
};
