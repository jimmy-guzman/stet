import { Show } from "solid-js";

import { state } from "@/state";
import { useTheme } from "@/theme/context";
import { fileIconModel, symlinkIconModel } from "@/utils/file-icon";

/**
 * Keeps the shared file icon in a fixed two-cell box so Nerd Font width cannot shift list columns.
 * The repo-relative path lets full-path associations resolve consistently across every surface.
 */
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
