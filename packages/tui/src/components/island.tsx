import type { JSX } from "@opentui/solid";

import { theme } from "@/theme/context";

import { ISLAND_PAD } from "./bar";

/** A run of bar text that interrupts the rule: the base surface plus a space on each side. */
export const Island = (props: { children: JSX.Element }) => (
  <box
    flexDirection="row"
    paddingLeft={ISLAND_PAD}
    paddingRight={ISLAND_PAD}
    backgroundColor={theme.colors.surface.base}
  >
    {props.children}
  </box>
);
