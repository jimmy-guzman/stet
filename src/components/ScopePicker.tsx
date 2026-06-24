import type { ScrollBoxRenderable } from "@opentui/core";
import { createEffect, Index } from "solid-js";

import { scopeKinds, scopePickerLabel } from "../cli";
import { state } from "../state";
import { useTheme } from "../theme/context";

export function ScopePicker() {
  const theme = useTheme();
  let scopeRef: ScrollBoxRenderable | undefined;

  createEffect(() => {
    scopeRef?.scrollChildIntoView(`scope-${state.scopeIndex()}`);
  });

  return (
    <box
      position="absolute"
      left={state.paletteLeft()}
      top={1}
      width={state.paletteWidth()}
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.colors.border.focused}
      backgroundColor={theme.colors.surface.panel}
      zIndex={100}
    >
      <box height={1} paddingLeft={1} backgroundColor={theme.colors.surface.panel}>
        <text fg={theme.colors.text.strong}>scope</text>
      </box>
      <scrollbox
        ref={(el) => (scopeRef = el)}
        width="100%"
        height={scopeKinds.length}
        scrollY
        viewportCulling
        scrollbarOptions={{
          trackOptions: {
            backgroundColor: theme.rgba.transparent,
            foregroundColor: theme.colors.scrollbar.thumb,
          },
        }}
      >
        {/* Id-by-index is required: reordering must never change a live renderable's id */}
        <Index each={scopeKinds}>
          {(kind, index) => {
            const current = () => kind() === state.scope().kind;
            const nameFg = () =>
              index === state.scopeIndex() ? theme.colors.text.selected : theme.colors.text.strong;
            return (
              <box
                id={`scope-${index}`}
                width="100%"
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={
                  index === state.scopeIndex()
                    ? theme.colors.surface.cursor
                    : theme.colors.surface.panel
                }
              >
                <text fg={nameFg()}>{`${current() ? "● " : "  "}${scopePickerLabel(kind())}`}</text>
              </box>
            );
          }}
        </Index>
      </scrollbox>
    </box>
  );
}
