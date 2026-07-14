import { Show } from "solid-js";

import type { ImageMeta } from "@/file/image-meta";
import type { BinaryDiff, SideMeta } from "@/git/file-patch";
import { useTheme } from "@/theme/context";
import { formatBytes } from "@/utils/format-bytes";

import { FileIcon } from "./FileIcon";

// The viewer surface for a binary file, which stet cannot render as pixels (OpenTUI has no SIXEL/
// Kitty graphics path, anomalyco/opentui#92). Instead of a blank pane it shows the metadata an IDE
// Surfaces for an image: type, dimensions, and size, in file-content mode from the single viewed
// Side and in diff mode as an old -> new delta. Centered like the empty "nothing to inspect" state,
// Theme tokens only, and reserving the full viewer height so opening a binary never shifts layout.
// The heading reuses the fixed-width file icon shared by list surfaces. Dimensions use `x` and the
// Delta `->`, both width-1 ASCII, since math glyph widths vary between terminal fonts.

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
