import type { MouseEvent } from "@opentui/core";

import { state } from "@/state";
import { theme } from "@/theme/context";

import { ActionText } from "./action-text";

export const QuitConfirm = (props: { onQuit: () => void }) => (
  // Full-screen barrier: an alert dialog blocks the app behind it. The scrim dims
  // The background, and capturing mouse-down keeps a background click inert (never
  // Passing through to the tree/viewer, never dismissing). The keymap traps keys.
  <box
    position="absolute"
    left={0}
    top={0}
    width="100%"
    height="100%"
    backgroundColor={theme.rgba.scrim}
    zIndex={100}
    onMouseDown={(event: MouseEvent) => {
      event.stopPropagation();
    }}
  >
    <box
      position="absolute"
      left={state.overlayLeft()}
      top={1}
      width={state.overlayWidth()}
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.colors.border.focused}
      backgroundColor={theme.colors.surface.panel}
    >
      <box
        height={1}
        paddingLeft={1}
        backgroundColor={theme.colors.surface.panel}
      >
        <text selectable={false} fg={theme.colors.text.strong}>
          Quit stet?
        </text>
      </box>
      <box
        height={1}
        flexDirection="row"
        paddingLeft={1}
        backgroundColor={theme.colors.surface.panel}
      >
        <ActionText label="y quit" onPress={props.onQuit} />
        <text selectable={false} fg={theme.colors.text.muted}>
          {" · "}
        </text>
        <ActionText
          label="esc cancel"
          onPress={() => {
            state.setQuitConfirmOpen(false);
          }}
        />
      </box>
    </box>
  </box>
);
