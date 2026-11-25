import type { ClipboardService } from "@opentui/core";

/** The one clipboard operation stet uses. */
export type ClipboardWriter = Pick<ClipboardService, "writeText">;

// Process-global like the keybinding registry: the terminal half of a write needs the renderer,
// Which only `main.tsx` has (it never enters `state`), so it registers the composed clipboard. A
// Test registers its own, so none can reach the real one.
let active: ClipboardWriter | undefined;

export const registerClipboard = (writer: ClipboardWriter | undefined) => {
  active = writer;
};

export const clipboardWriter = () => active;
