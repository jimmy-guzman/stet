import { MouseButton } from "@opentui/core";
import type { MouseEvent } from "@opentui/core";
import { batch } from "solid-js";

import type { CommandMenuContext } from "@/components/command-menu/items";
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
 * Whether a press only closes the open context menu: a left press anywhere does, as a click outside a
 * desktop menu does, rather than also acting on what lies under it.
 */
export const pressOnlyClosesMenu = (event: MouseEvent) =>
  isLeftClick(event) && state.commandMenuOpen();

/**
 * On a right-click, open a context menu at the pointer on what it landed on. `select` moves focus and
 * the cursor onto the target in the same batch as closing any menu already open, and the press stops
 * here, so the app's root does not close the menu it just opened.
 *
 * @returns Whether the press was a right-click, so the caller does nothing else with it.
 */
export const openMenuAt = (
  event: MouseEvent,
  context: CommandMenuContext,
  select: () => void
) => {
  if (!isRightClick(event)) {
    return false;
  }

  event.stopPropagation();
  batch(() => {
    state.closeCommandMenu();
    select();
  });
  state.openCommandMenu(context, { x: event.x, y: event.y });

  return true;
};

/**
 * A left click's action. Another button passes through to the target's ancestors untouched (a
 * middle press only focuses the pane, a side button steps history), and a press that only closes
 * the menu does that and stops.
 */
export const leftPress =
  (run: (event: MouseEvent) => void) => (event: MouseEvent) => {
    if (!isLeftClick(event)) {
      return;
    }

    if (pressOnlyClosesMenu(event)) {
      event.stopPropagation();
      state.closeCommandMenu();

      return;
    }

    batch(() => {
      run(event);
    });
  };
