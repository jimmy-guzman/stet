import { fg, StyledText } from "@opentui/core";
import type { TextRenderable } from "@opentui/core";
import { createEffect } from "solid-js";

import type { RenderSpan } from "@/diff/hast";
import { sliceSpansWindow } from "@/diff/spans";
import { useTheme } from "@/theme/context";

// One highlighted code line as a single StyledText buffer (the diff's StyledLine
// Pattern): per-token colors without one <text> per token, set imperatively
// Because StyledText is not a typed JSX child. Shared by every surface that shows
// A source line (search results, references previews).
export function CodeLine(props: { spans: () => RenderSpan[]; width: () => number }) {
  const theme = useTheme();
  let ref: TextRenderable | undefined;
  createEffect(() => {
    if (ref === undefined) {
      return;
    }
    const windowed = sliceSpansWindow(props.spans(), 0, props.width());
    ref.content = new StyledText(
      (windowed.length === 0 ? [{ text: "" }] : windowed).map((span) =>
        fg(span.fg ?? theme.colors.text.primary)(span.text),
      ),
    );
  });
  return <text ref={(el) => (ref = el)} wrapMode="none" height={1} />;
}
