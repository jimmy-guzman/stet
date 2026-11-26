import { SliderRenderable } from "@opentui/core";
import type { MouseEvent } from "@opentui/core";
import { useRenderer } from "@opentui/solid";
import { createEffect } from "solid-js";

import { theme } from "@/theme/context";

import { isLeftClick } from "./mouse";

/**
 * A slider inside a pane. OpenTUI's takes any button and keeps the press to itself, so a press here
 * would not focus the pane, and a right-click would scroll it. The pane gets every press first, and
 * the slider only the left one.
 */
class PaneSliderRenderable extends SliderRenderable {
  override processMouseEvent(event: MouseEvent) {
    if (event.type === "down") {
      this.parent?.processMouseEvent(event);

      if (!isLeftClick(event)) {
        return;
      }
    }

    super.processMouseEvent(event);
  }
}

/**
 * The scrollbar of a windowed list, which mounts only its visible slice and so leaves a scrollbox
 * nothing to measure. It is OpenTUI's slider, built here because Solid has no element for it. The
 * standalone `ScrollBarRenderable` around that slider is no use: it sizes the thumb against the range
 * of the moment, so a list whose rows arrive after its pane keeps the smallest one. The column stays
 * reserved while the content fits, so content growth never shifts layout.
 */
export const ListScrollbar = (props: {
  rowCount: () => number;
  viewport: () => number;
  scrollTop: () => number;
  setScrollTop: (next: number) => void;
}) => {
  // The slider reports a value the list gave it exactly as it reports a drag, and only a drag moves
  // The list.
  let syncing = false;

  const slider = new PaneSliderRenderable(useRenderer(), {
    height: "100%",
    onChange: (value) => {
      if (!syncing) {
        props.setScrollTop(Math.round(value));
      }
    },
    orientation: "vertical",
    width: 1,
  });

  createEffect(() => {
    const rows = props.rowCount();
    const viewport = props.viewport();
    const range = Math.max(0, rows - viewport);

    syncing = true;
    // The slider clamps the thumb to the range it has when the thumb is set, so that is the whole
    // List's until the thumb is in.
    slider.max = rows;
    slider.viewPortSize = viewport;
    slider.max = range;
    slider.value = props.scrollTop();
    slider.visible = range > 0;
    syncing = false;
  });

  createEffect(() => {
    slider.backgroundColor = theme.rgba.transparent;
    slider.foregroundColor = theme.colors.scrollbar.thumb;
  });

  return (
    <box
      ref={(el) => {
        el.add(slider);
      }}
      width={1}
      height={props.viewport()}
    />
  );
};
