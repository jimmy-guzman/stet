/**
 * Shiki themes for docs code blocks, mapped onto stet's own syntax palette so highlighted code
 * reads identically to the TUI. Ported self-contained from `src/theme/shiki.ts` (the scope->token
 * mapping) and `src/theme/dark.ts` / `src/theme/light.ts` (the token hexes). Keep in sync with
 * those files; this is a deliberate duplication so the docs build never reaches outside `docs/`.
 */
interface Tokens {
  bg: string;
  fg: string;
  comment: string;
  function: string;
  keyword: string;
  keywordControl: string;
  keywordImport: string;
  member: string;
  number: string;
  operator: string;
  punctuation: string;
  string: string;
  tag: string;
  type: string;
}

function buildTheme(name: string, type: "dark" | "light", t: Tokens) {
  return {
    name,
    type,
    bg: t.bg,
    fg: t.fg,
    settings: [
      { scope: ["comment"], settings: { fontStyle: "italic", foreground: t.comment } },
      {
        scope: ["keyword", "storage", "storage.type", "storage.modifier", "keyword.control"],
        settings: { fontStyle: "bold", foreground: t.keyword },
      },
      {
        scope: [
          "keyword.control.import",
          "keyword.control.export",
          "keyword.control.from",
          "keyword.control.default",
        ],
        settings: { fontStyle: "bold", foreground: t.keywordImport },
      },
      {
        scope: ["keyword.control.flow", "storage.modifier.async"],
        settings: { fontStyle: "bold", foreground: t.keywordControl },
      },
      {
        scope: ["keyword.operator", "punctuation.accessor", "operator"],
        settings: { foreground: t.operator },
      },
      { scope: ["string", "string.quoted", "string.template"], settings: { foreground: t.string } },
      {
        scope: ["constant.character.escape", "string.regexp"],
        settings: { foreground: t.operator },
      },
      { scope: ["constant.numeric"], settings: { foreground: t.number } },
      { scope: ["constant.language"], settings: { fontStyle: "bold", foreground: t.number } },
      {
        scope: ["constant", "support.constant", "variable.other.constant"],
        settings: { foreground: t.number },
      },
      {
        scope: ["entity.name.function", "support.function", "meta.function-call.generic"],
        settings: { foreground: t.function },
      },
      {
        scope: ["entity.name.type", "support.type", "support.class", "entity.name.class"],
        settings: { foreground: t.type },
      },
      {
        scope: ["variable.other.property", "meta.object-literal.key", "support.variable"],
        settings: { foreground: t.member },
      },
      { scope: ["entity.name.namespace", "entity.name.label"], settings: { foreground: t.member } },
      { scope: ["entity.name.tag"], settings: { foreground: t.tag } },
      {
        scope: ["entity.other.attribute-name"],
        settings: { fontStyle: "italic", foreground: t.type },
      },
      { scope: ["variable"], settings: { foreground: t.fg } },
      { scope: ["punctuation"], settings: { foreground: t.punctuation } },
      { scope: ["markup.heading"], settings: { fontStyle: "bold", foreground: t.keyword } },
      { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
      { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
      { scope: ["markup.inline.raw", "markup.raw"], settings: { foreground: t.string } },
      {
        scope: ["markup.underline.link"],
        settings: { fontStyle: "underline", foreground: t.function },
      },
    ],
  };
}

export const stetDark = buildTheme("stet-dark", "dark", {
  bg: "#191b1d",
  fg: "#e9ebee",
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
});

export const stetLight = buildTheme("stet-light", "light", {
  bg: "#f7f8fa",
  fg: "#2a2e33",
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
});
