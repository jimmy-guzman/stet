import type { LLMsOptions } from "fumadocs-core/mdx-plugins/remark-llms";

import { siteUrl } from "./site";

/**
 * Absolute image URLs in the LLM output. A screenshot is the one reference an agent dereferences
 * outside a browser, so the site-relative `/screenshots/...` path it is authored with is useless
 * once the markdown is read from `llms-full.txt` or a `.md` route.
 */
export const markdownImage: NonNullable<LLMsOptions["stringify"]> = (node) => {
  if (node.type !== "image" || !node.url.startsWith("/")) return undefined;

  return `![${node.alt ?? ""}](${siteUrl}${node.url})`;
};
