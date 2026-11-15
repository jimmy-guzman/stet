import type { Theme as ZedTheme } from "@pierre/highlights";

import type { Theme } from "./tokens";

export const STET_SYNTAX_THEME_NAME = "stet";

/**
 * Builds a Zed-format syntax theme (what the `highlights` backend reads) from any stet Theme, so
 * code colors come from the same `syntax` tokens as the rest of the UI rather than a separate
 * palette. Only colors are mapped: the viewer reads a token's color and nothing else. Zed scopes
 * inherit from their nearest configured parent, so `keyword.declaration` takes `keyword` and
 * `punctuation.bracket` takes `punctuation` without listing them.
 */
export const syntaxTheme = (
  theme: Theme,
  appearance: "dark" | "light"
): ZedTheme => {
  const { syntax } = theme;

  return {
    appearance,
    name: STET_SYNTAX_THEME_NAME,
    style: {
      background: theme.surface.base,
      foreground: theme.text.primary,
      syntax: {
        attribute: syntax.type,
        boolean: syntax.number,
        comment: syntax.comment,
        constant: syntax.number,
        constructor: syntax.type,
        emphasis: theme.text.primary,
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
        variable: theme.text.primary,
      },
    },
  };
};
