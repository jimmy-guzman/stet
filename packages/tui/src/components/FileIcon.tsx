import { Show } from "solid-js";

import { state } from "@/state";
import { useTheme } from "@/theme/context";
import { fileIcon, symlinkIcon } from "@/utils/file-icon";

// A file-leaf icon in the fixed 2-cell box shared by every list surface (tree,
// Search, file picker, references, problems). Self-gates on `iconsEnabled`, so a
// Caller drops it in unconditionally; the box keeps the following column steady
// Because Nerd Font glyphs can be double-width. Monochrome `text.muted` for now,
// Matching the tree; per-type icon color is a deliberate follow-up. Directories
// And collapse toggles are not file leaves and stay inline at their call sites.
export function FileIcon(props: { name: string; symlink?: boolean }) {
  const theme = useTheme();
  return (
    <Show when={state.iconsEnabled()}>
      <box width={2} overflow="hidden">
        <text fg={theme.colors.text.muted}>
          {props.symlink ? symlinkIcon() : fileIcon(props.name)}
        </text>
      </box>
    </Show>
  );
}
