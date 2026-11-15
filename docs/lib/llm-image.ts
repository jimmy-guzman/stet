import { replaceSource } from "fumadocs-core/mdx-plugins/stringifier";

import { siteUrl } from "./site";

type VFile = Parameters<typeof replaceSource>[0];

type MdastNode = Parameters<typeof replaceSource>[1];

/**
 * Alt and title escaped the way fumadocs' own remark-image writes them, plus the URL's angle
 * brackets and backslashes, which remark-image leaves bare, so a `>` in a path cannot end the
 * destination early.
 */
const imageMarkdown = (alt: string, url: string, title: string) =>
  `![${alt.replaceAll(/[\\[\]]/gu, String.raw`\$&`)}](<${url.replaceAll(/[<>\\]/gu, String.raw`\$&`)}>${
    title === "" ? "" : ` "${title.replaceAll(/["\\]/gu, String.raw`\$&`)}"`
  })`;

const absolutize = (node: MdastNode, file: VFile): void => {
  if (node.type === "image" && node.url.startsWith("/")) {
    replaceSource(
      file,
      node,
      imageMarkdown(node.alt ?? "", `${siteUrl}${node.url}`, node.title ?? ""),
      "markdown"
    );

    return;
  }

  if ("children" in node) {
    for (const child of node.children) {
      absolutize(child, file);
    }
  }
};

/**
 * Absolute image URLs in the LLM output. A screenshot is the one reference an agent dereferences
 * outside a browser, so the site-relative `/screenshots/...` path it is authored with is useless
 * once the markdown is read from `llms-full.txt` or a `.md` route.
 */
export const remarkAbsoluteImages = () => (tree: MdastNode, file: VFile) => {
  absolutize(tree, file);
};
