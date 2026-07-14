import { Show } from "solid-js";

import { state } from "@/state";
import { useTheme } from "@/theme/context";
import { fileIconModel, symlinkIconModel } from "@/utils/file-icon";

// A file-leaf icon in the fixed 2-cell box shared by every list surface (tree,
// Search, file picker, references, problems). Self-gates on `iconsEnabled`, so a
// Caller drops it in unconditionally; the box keeps the following column steady
// Because Nerd Font glyphs can be double-width. `path` stays repo-relative so a
// Full-path file association can drive the same icon as every other file facet.
export function FileIcon(props: { path: string; symlink?: boolean }) {
  const theme = useTheme();
  const model = () => (props.symlink ? symlinkIconModel() : fileIconModel(props.path));
  return (
    <Show when={state.iconsEnabled()}>
      <box width={2} overflow="hidden">
        <text fg={theme.colors.icon[model().name] ?? theme.colors.text.muted}>{model().glyph}</text>
      </box>
    </Show>
  );
}
