import { fg, StyledText } from "@opentui/core";
import type { TextRenderable } from "@opentui/core";
import { createEffect, createMemo, Index, Show } from "solid-js";

import type { RenderSpan } from "@/diff/hast";
import { sliceSpansWindow } from "@/diff/spans";
import { state } from "@/state";
import { useTheme } from "@/theme/context";
import { truncate } from "@/utils/text";
import { caretCell, placeCard } from "@/viewer/anchor";

// A caret-anchored decoration is capped so a verbose reply (a long doc comment)
// Stays a glanceable card, not a second pane; overflow collapses to a trailing
// Ellipsis line rather than scrolling, the keyboard-only v1 behavior.
const MAX_CARD_LINES = 12;
const MAX_CARD_WIDTH = 72;

type RenderLine = { kind: "code"; spans: RenderSpan[] } | { kind: "prose"; text: string };

function lineWidth(line: RenderLine) {
  return line.kind === "code"
    ? line.spans.reduce((sum, span) => sum + Bun.stringWidth(span.text), 0)
    : Bun.stringWidth(line.text);
}

function proseText(line: RenderLine) {
  return line.kind === "prose" ? line.text : "";
}

// One card row: a highlighted code line (its spans as a single `StyledText`, set
// Imperatively like the diff's `StyledLine`) or a plain prose line (muted for the
// Loading/empty/error states, secondary for docs).
function CardLine(props: { line: () => RenderLine; muted: () => boolean }) {
  const theme = useTheme();
  let ref: TextRenderable | undefined;
  createEffect(() => {
    const line = props.line();
    if (ref === undefined || line.kind !== "code") {
      return;
    }
    ref.content = new StyledText(
      line.spans.map((span) => fg(span.fg ?? theme.colors.text.primary)(span.text)),
    );
  });
  return (
    <Show
      when={props.line().kind === "code"}
      fallback={
        <text fg={props.muted() ? theme.colors.text.muted : theme.colors.text.secondary}>
          {proseText(props.line())}
        </text>
      }
    >
      <text ref={(el) => (ref = el)} />
    </Show>
  );
}

/**
 * The floating card for the active caret-anchored decoration (hover today, peek later). Absolutely
 * positioned inside the viewer content area so it never clips against the scrollbox or shifts the
 * diff; placed below the caret and flipped above near the bottom edge. The geometry DiffView
 * already computes (the caret's cumulative top, the gutter+sign offset, the inner width) arrives as
 * accessors.
 */
export function CaretCard(props: {
  cursorTop: () => number | undefined;
  caretFrom: () => number | undefined;
  contentLeft: () => number;
  innerWidth: () => number;
}) {
  const theme = useTheme();

  const card = createMemo(() => {
    const decoration = state.viewerDecoration();
    const cursorTop = props.cursorTop();
    const caretFrom = props.caretFrom();
    if (decoration === undefined || cursorTop === undefined || caretFrom === undefined) {
      return undefined;
    }
    const viewportHeight = state.viewerHeight();
    const viewportWidth = props.innerWidth();
    const anchor = caretCell({
      caretFrom,
      contentLeft: props.contentLeft(),
      cursorTop,
      scrollTop: state.viewerScrollTop(),
      scrollX: state.viewerScrollX(),
      viewportHeight,
      viewportWidth,
    });
    if (anchor === undefined) {
      return undefined;
    }
    // Leave room for the border (2) and a column of padding each side (2).
    const textWidth = Math.max(8, Math.min(MAX_CARD_WIDTH, viewportWidth - 4));
    const capped = decoration.lines.slice(0, MAX_CARD_LINES);
    const lines: RenderLine[] = capped.map((line) =>
      line.kind === "code"
        ? { kind: "code", spans: sliceSpansWindow(line.spans, 0, textWidth) }
        : { kind: "prose", text: truncate(line.text, textWidth) },
    );
    if (decoration.lines.length > MAX_CARD_LINES) {
      lines.push({ kind: "prose", text: "…" });
    }
    const contentWidth = Math.max(0, ...lines.map(lineWidth));
    // `placeCard` only constrains the left edge, so cap the width here: a pane too
    // Narrow for even the 8-cell text floor must not let the card run off the right.
    const width = Math.min(contentWidth + 4, viewportWidth);
    const placement = placeCard({
      anchor,
      cardHeight: lines.length + 2,
      cardWidth: width,
      viewportHeight,
      viewportWidth,
    });
    return { lines, muted: decoration.status !== "ready", placement, width };
  });

  return (
    <Show when={card()}>
      {(value) => (
        <box
          position="absolute"
          top={value().placement.top}
          left={value().placement.left}
          width={value().width}
          flexDirection="column"
          borderStyle="single"
          borderColor={theme.colors.border.focused}
          backgroundColor={theme.colors.surface.panel}
          paddingLeft={1}
          paddingRight={1}
          zIndex={50}
        >
          <Index each={value().lines}>
            {(line) => <CardLine line={line} muted={() => value().muted} />}
          </Index>
        </box>
      )}
    </Show>
  );
}
