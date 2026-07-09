// Flattens the per-line HAST that `@pierre/diffs` emits (one <div> per line,
// Children are <span style="color:#rrggbb">text</span>) into terminal-ready
// Spans. `@pierre/diffs` renders for the DOM; this is the piece it cannot give
// Us. Inputs are treated as unknown and structurally narrowed, so no `hast` or
// DOM dependency is needed.

export interface RenderSpan {
  text: string;
  fg?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function colorFromStyle(style: unknown) {
  if (typeof style !== "string") {
    return undefined;
  }
  const match = /color:\s*(?<color>#[0-9a-fA-F]{3,8}|[a-zA-Z]+)/.exec(style);
  return match?.groups?.color;
}

function walk(node: unknown, inheritedFg: string | undefined, out: RenderSpan[]) {
  if (!isRecord(node)) {
    return;
  }

  if (node.type === "text") {
    if (typeof node.value === "string" && node.value !== "") {
      out.push(
        inheritedFg === undefined ? { text: node.value } : { fg: inheritedFg, text: node.value },
      );
    }
    return;
  }

  if (node.type !== "element" || !Array.isArray(node.children)) {
    return;
  }

  const properties = isRecord(node.properties) ? node.properties : undefined;
  const fg = colorFromStyle(properties?.style) ?? inheritedFg;
  for (const child of node.children) {
    walk(child, fg, out);
  }
}

/**
 * Flatten one line node into ordered spans. A missing node (line absent from the highlighted
 * result) yields no spans so the caller can fall back to plain text.
 */
export function flattenLineSpans(line: unknown): RenderSpan[] {
  const out: RenderSpan[] = [];
  if (isRecord(line) && Array.isArray(line.children)) {
    for (const child of line.children) {
      walk(child, undefined, out);
    }
  }

  const last = out.at(-1);
  if (last !== undefined && last.text.endsWith("\n")) {
    last.text = last.text.slice(0, -1);
  }

  return out;
}
