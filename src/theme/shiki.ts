import type { ThemeRegistration } from "@pierre/diffs";

import { darkTheme } from "./dark";

// Sideye's syntax palette as a Shiki theme, mapping TextMate scopes onto the
// `darkTheme.syntax` tokens so `@pierre/diffs`/Shiki highlights diffs in the same
// Single source of truth as the rest of the UI (no separate palette). Font styles
// Are emphasis, not color, so they stay here. A light theme would map a second
// ThemeRegistration over its own tokens.
const {
  comment,
  function: fn,
  keyword,
  member,
  number,
  operator,
  punctuation,
  string,
  tag,
  type,
} = darkTheme.syntax;

export const SIDEYE_SHIKI_THEME_NAME = "sideye-dark";

export const SIDEYE_SHIKI_THEME: ThemeRegistration = {
  bg: darkTheme.surface.base,
  fg: darkTheme.text.primary,
  name: SIDEYE_SHIKI_THEME_NAME,
  settings: [
    { scope: ["comment"], settings: { fontStyle: "italic", foreground: comment } },
    {
      scope: ["keyword", "storage", "storage.type", "storage.modifier", "keyword.control"],
      settings: { fontStyle: "bold", foreground: keyword },
    },
    {
      scope: ["keyword.operator", "punctuation.accessor", "operator"],
      settings: { foreground: operator },
    },
    { scope: ["string", "string.quoted", "string.template"], settings: { foreground: string } },
    { scope: ["constant.character.escape", "string.regexp"], settings: { foreground: operator } },
    { scope: ["constant.numeric"], settings: { foreground: number } },
    { scope: ["constant.language"], settings: { fontStyle: "bold", foreground: number } },
    {
      scope: ["constant", "support.constant", "variable.other.constant"],
      settings: { foreground: number },
    },
    {
      scope: ["entity.name.function", "support.function", "meta.function-call.generic"],
      settings: { foreground: fn },
    },
    {
      scope: ["entity.name.type", "support.type", "support.class", "entity.name.class"],
      settings: { foreground: type },
    },
    {
      scope: ["variable.other.property", "meta.object-literal.key", "support.variable"],
      settings: { foreground: member },
    },
    { scope: ["entity.name.namespace", "entity.name.label"], settings: { foreground: member } },
    { scope: ["entity.name.tag"], settings: { foreground: tag } },
    { scope: ["entity.other.attribute-name"], settings: { fontStyle: "italic", foreground: type } },
    { scope: ["variable"], settings: { foreground: darkTheme.text.primary } },
    { scope: ["punctuation"], settings: { foreground: punctuation } },
    // Markdown
    { scope: ["markup.heading"], settings: { fontStyle: "bold", foreground: keyword } },
    { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
    { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
    { scope: ["markup.inline.raw", "markup.raw"], settings: { foreground: string } },
    { scope: ["markup.underline.link"], settings: { fontStyle: "underline", foreground: fn } },
  ],
  type: "dark",
};
