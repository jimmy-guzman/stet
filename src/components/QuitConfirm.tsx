import type { MouseEvent } from "@opentui/core";

import { state } from "@/state";
import { useTheme } from "@/theme/context";

export function QuitConfirm() {
  const theme = useTheme();
  return (
    // Full-screen barrier: an alert dialog blocks the app behind it. The scrim dims
    // The background, and capturing mouse-down keeps a background click inert (never
    // Passing through to the tree/viewer, never dismissing). The keymap traps keys.
    <box
      ref={(el) => {
        el.selectable = false;
        el.focusable = false;
      }}
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      backgroundColor={theme.rgba.scrim}
      zIndex={100}
      onMouseDown={(event: MouseEvent) => event.stopPropagation()}
    >
      <box
        ref={(el) => {
          el.selectable = false;
          el.focusable = false;
        }}
        position="absolute"
        left={state.overlayLeft()}
        top={1}
        width={state.overlayWidth()}
        flexDirection="column"
        borderStyle="single"
        borderColor={theme.colors.border.focused}
        backgroundColor={theme.colors.surface.panel}
      >
        <box height={1} paddingLeft={1} backgroundColor={theme.colors.surface.panel}>
          <text
            ref={(el) => {
              el.selectable = false;
              el.focusable = false;
            }}
            fg={theme.colors.text.strong}
          >
            Quit stet?
          </text>
        </box>
        <box height={1} paddingLeft={1} backgroundColor={theme.colors.surface.panel}>
          <text
            ref={(el) => {
              el.selectable = false;
              el.focusable = false;
            }}
            fg={theme.colors.text.muted}
          >
            y quit · esc cancel
          </text>
        </box>
      </box>
    </box>
  );
}
