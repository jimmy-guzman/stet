import { theme } from "@/theme/context";

import { leftPress } from "./mouse";
import { hoverable } from "./pointer";

/**
 * A label in the chrome that does what it names when clicked: a bar's hint, a dialog's answer, a
 * footer's key. It lifts to the primary text tier under the pointer, a change of brightness that
 * reads without color, and its text is not selectable, so a press that wobbles copies nothing.
 */
export const ActionText = (props: {
  label: string;
  fg?: string;
  onPress: () => void;
  /** A label standing alone in a pane wraps to its width; one inside a budgeted bar never does. */
  wraps?: boolean;
}) => {
  const hover = hoverable("pointer");

  return (
    <box
      ref={hover.ref}
      flexShrink={props.wraps === true ? 1 : 0}
      onMouseDown={leftPress(props.onPress)}
    >
      <text
        selectable={false}
        wrapMode={props.wraps === true ? "word" : "none"}
        fg={
          hover.hovered()
            ? theme.colors.text.primary
            : (props.fg ?? theme.colors.text.muted)
        }
      >
        {props.label}
      </text>
    </box>
  );
};
