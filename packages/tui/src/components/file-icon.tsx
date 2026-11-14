import { Show } from "solid-js";

import { fileIconForPath, namedIcon } from "@/file-support/registry";
import { state } from "@/state";
import { theme } from "@/theme/context";

/**
 * Keeps the shared file icon in a fixed two-cell box so Nerd Font width cannot shift list columns.
 * The repo-relative path lets full-path associations resolve consistently across every surface.
 */
export const FileIcon = (props: { path: string; symlink?: boolean }) => {
  const model = () =>
    props.symlink === true ? namedIcon("symlink") : fileIconForPath(props.path);

  return (
    <Show when={state.iconsEnabled()}>
      <box width={2} overflow="hidden">
        <text fg={theme.colors.icon[model().name] ?? theme.colors.text.muted}>
          {model().glyph}
        </text>
      </box>
    </Show>
  );
};
