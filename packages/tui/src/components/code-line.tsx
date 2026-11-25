import { fg, StyledText } from "@opentui/core";
import type { TextRenderable } from "@opentui/core";
import { createEffect } from "solid-js";

import type { RenderSpan } from "@/diff/hast";
import { theme } from "@/theme/context";

// One highlighted code line as a single StyledText buffer (the diff's StyledLine
// Pattern): per-token colors without one <text> per token, set imperatively
// Because StyledText is not a typed JSX child. Shared by every surface that shows
// A source line (search results).
export const CodeLine = (props: { spans: () => RenderSpan[] }) => {
  let ref: TextRenderable | undefined;
  createEffect(() => {
    if (ref === undefined) {
      return;
    }

    ref.content = new StyledText(
      props
        .spans()
        .map((span) => fg(span.fg ?? theme.colors.text.primary)(span.text))
    );
  });

  return (
    <text
      ref={(el) => {
        ref = el;
      }}
      selectable={false}
      wrapMode="none"
    />
  );
};
