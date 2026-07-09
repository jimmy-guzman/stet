import { Show } from "solid-js";

import { state } from "@/state";
import { useTheme } from "@/theme/context";
import { symbolKindIcon, symbolKindTag } from "@/utils/symbol-icon";

// A symbol-kind indicator for the outline overlay, mirroring `FileIcon`: a Nerd Font codicon in a
// Fixed 2-cell box under a Nerd Font, self-gating on `iconsEnabled`. When icons are off it falls
// Back to a font-independent 3-cell text tag, so the kind still reads (and under NO_COLOR too).
// Monochrome `text.muted` for now, matching `FileIcon`; per-kind color is a deliberate follow-up.
export function SymbolKindIcon(props: { kind: number }) {
  const theme = useTheme();
  return (
    <Show
      when={state.iconsEnabled()}
      fallback={
        <box width={3} overflow="hidden">
          <text fg={theme.colors.text.muted}>{symbolKindTag(props.kind)}</text>
        </box>
      }
    >
      <box width={2} overflow="hidden">
        <text fg={theme.colors.text.muted}>{symbolKindIcon(props.kind)}</text>
      </box>
    </Show>
  );
}
