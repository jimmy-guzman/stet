import type { RenderDiffFilesResult } from "@pierre/diffs";
import { Predicate } from "effect";

// Flattens the per-line HAST that `@pierre/diffs` emits (one <div> per line,
// Children are <span style="color:#rrggbb">text</span>) into terminal-ready
// Spans. `@pierre/diffs` renders for the DOM; this is the piece it cannot give
// Us. The node type comes from the library's own result, so no `hast` or DOM
// Dependency is needed.

type HastNode = RenderDiffFilesResult["additionLines"][number];

export interface RenderSpan {
  text: string;
  fg?: string;
}

const colorFromStyle = (style: string) =>
  /color:\s*(?<color>#[0-9a-fA-F]{3,8}|[a-zA-Z]+)/u.exec(style)?.groups?.color;

const walk = (
  node: HastNode,
  inheritedFg: string | undefined,
  out: RenderSpan[]
) => {
  if (node.type === "text") {
    if (node.value !== "") {
      out.push(
        inheritedFg === undefined
          ? { text: node.value }
          : { fg: inheritedFg, text: node.value }
      );
    }

    return;
  }

  if (node.type !== "element") {
    return;
  }

  const { style } = node.properties;

  const fg =
    (Predicate.isString(style) ? colorFromStyle(style) : undefined) ??
    inheritedFg;

  for (const child of node.children) {
    walk(child, fg, out);
  }
};

/**
 * Flatten one line node into ordered spans. A missing node (line absent from the highlighted
 * result) yields no spans so the caller can fall back to plain text.
 */
export const flattenLineSpans = (line: HastNode | undefined): RenderSpan[] => {
  const out: RenderSpan[] = [];

  if (line?.type === "element") {
    for (const child of line.children) {
      walk(child, undefined, out);
    }
  }

  const last = out.at(-1);

  if (last !== undefined && last.text.endsWith("\n")) {
    last.text = last.text.slice(0, -1);
  }

  return out;
};
