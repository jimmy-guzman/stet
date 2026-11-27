import { ScrollBoxRenderable } from "@opentui/core";
import type { MouseEvent } from "@opentui/core";
import { createSignal } from "solid-js";

import { theme } from "@/theme/context";

import { isLeftClick } from "./mouse";
import { hoverable } from "./pointer";

/**
 * A thumb's color: lit while the pointer is over its bar or holds it in a drag. A drag is its own
 * signal, as the divider's is, because the hover can leave mid-drag: OpenTUI sends the first `over`
 * of a drag before it captures the press, so that one event carries no `source` for the pointer
 * tracker to drop.
 */
export const thumbColor = (lit: boolean) =>
  lit ? theme.colors.scrollbar.active : theme.colors.scrollbar.thumb;

// A `<scrollbox>` paints its bar itself, with no renderable of its own, so a press or a move over the
// Bar hits the scrollbox and only its geometry tells the bar from the rows.
const overBar = (event: MouseEvent, node: ScrollBoxRenderable) => {
  const { height, visible, width, x, y } = node.verticalScrollBar;

  return (
    visible &&
    event.x >= x &&
    event.x < x + width &&
    event.y >= y &&
    event.y < y + height
  );
};

/**
 * An overlay `<scrollbox>`'s vertical bar as a hover and drag target. Call `ref` from the scrollbox's
 * ref, pass `options()` as its `scrollbarOptions`, and its `onMouseDown`/`onMouseUp` as its own.
 */
export const scrollboxBar = () => {
  const bar = hoverable((event, node) =>
    node instanceof ScrollBoxRenderable && overBar(event, node)
      ? "default"
      : undefined
  );

  const [held, setHeld] = createSignal(false);

  return {
    onMouseDown: (event: MouseEvent) => {
      setHeld(
        isLeftClick(event) &&
          event.target instanceof ScrollBoxRenderable &&
          overBar(event, event.target)
      );
    },
    // The scrollbox holds the press it captured, so the release comes back to it wherever it lands.
    onMouseUp: () => {
      setHeld(false);
    },
    options: () => ({
      trackOptions: {
        backgroundColor: theme.rgba.transparent,
        foregroundColor: thumbColor(bar.hovered() || held()),
      },
    }),
    ref: bar.ref,
  };
};
