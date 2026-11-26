import { MouseButton } from "@opentui/core";
import type { MouseEvent } from "@opentui/core";
import { batch } from "solid-js";

import { state } from "@/state";

// OpenTUI types `MouseEvent.button` as a bare number, so a direct `=== MouseButton.RIGHT`
// Trips no-unsafe-enum-comparison. The enum member is that numeric code, so read it back
// As a number (`.valueOf()`) to compare like with like without a cast.
export const isRightClick = (event: MouseEvent) =>
  event.button === MouseButton.RIGHT.valueOf();

export const isLeftClick = (event: MouseEvent) =>
  event.button === MouseButton.LEFT.valueOf();

// A mouse's back and forward side buttons, which SGR reports as 128 and 129 and OpenTUI decodes as
// 8 and 9. Its enum stops at the wheel, so they are named here.
const BACK_BUTTON = 8;
const FORWARD_BUTTON = 9;

/**
 * Step viewer history on a side button, as `<` and `>` do.
 *
 * @returns Whether the press was a side button, so the caller does nothing else with it.
 */
export const pressHistoryButton = (event: MouseEvent) => {
  if (event.button === BACK_BUTTON) {
    state.goBack();

    return true;
  }

  if (event.button === FORWARD_BUTTON) {
    state.goForward();

    return true;
  }

  return false;
};

/**
 * A left click's handler, the one place a click reads its button. Another button passes through to
 * the target's ancestors untouched (a middle press does nothing, a side button steps history). While
 * the context menu is open, a left press anywhere only closes it, as a click outside a desktop menu
 * does, rather than also acting on what lies under it.
 */
export const leftPress =
  (run: (event: MouseEvent) => void) => (event: MouseEvent) => {
    if (!isLeftClick(event)) {
      return;
    }

    if (state.commandMenuOpen()) {
      event.stopPropagation();
      state.closeCommandMenu();

      return;
    }

    batch(() => {
      run(event);
    });
  };
