import { Show } from "solid-js";

import type { ImageMeta } from "@/file/image-meta";
import type { BinaryDiff, SideMeta } from "@/git/file-patch";
import { useTheme } from "@/theme/context";
import { formatBytes } from "@/utils/format-bytes";

import { FileIcon } from "./FileIcon";

const dimensions = (image: ImageMeta | undefined) =>
  image !== undefined && image.width > 0 && image.height > 0
    ? `${image.width}x${image.height}`
    : undefined;

const summary = (side: SideMeta) =>
  [dimensions(side.image), side.bytes > 0 ? formatBytes(side.bytes) : undefined]
    .filter((part) => part !== undefined)
    .join(" · ");

const typeLabel = (side: SideMeta | undefined) =>
  side?.image !== undefined ? `${side.image.format} image` : "Binary file";

/**
 * Shows metadata instead of a blank pane because OpenTUI has no SIXEL or Kitty graphics path.
 * Reserves the viewer height and uses width-stable ASCII for dimensions and deltas.
 */
export function BinaryPreview(props: {
  path: string;
  height: number;
  single?: SideMeta;
  diff?: BinaryDiff;
}) {
  const theme = useTheme();

  const labelSide = () => props.single ?? props.diff?.newSide ?? props.diff?.oldSide;

  const detail = () => {
    if (props.single !== undefined) {
      return summary(props.single);
    }
    const oldSide = props.diff?.oldSide;
    const newSide = props.diff?.newSide;
    if (oldSide !== undefined && newSide !== undefined) {
      return `${summary(oldSide)}  ->  ${summary(newSide)}`;
    }
    if (newSide !== undefined) {
      return `added · ${summary(newSide)}`;
    }
    if (oldSide !== undefined) {
      return `deleted · ${summary(oldSide)}`;
    }
    return "";
  };

  return (
    <box height={props.height} flexDirection="column" justifyContent="center" alignItems="center">
      <box flexDirection="row">
        <FileIcon path={props.path} />
        <text fg={theme.colors.text.secondary}>{typeLabel(labelSide())}</text>
      </box>
      <Show when={detail() !== ""}>
        <text fg={theme.colors.text.muted}>{detail()}</text>
      </Show>
      <text fg={theme.colors.text.faint}>can't preview here · O to open externally</text>
    </box>
  );
}
