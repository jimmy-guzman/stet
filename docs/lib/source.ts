import { docs } from "collections/server";
import { loader } from "fumadocs-core/source";

import { siteUrl } from "@/lib/site";

export const source = loader({
  baseUrl: "/docs",
  source: docs.toFumadocsSource(),
});

/**
 * The same content addressed by its markdown endpoints rather than its pages, so `llms.txt` lists
 * absolute URLs an agent can fetch as-is instead of site-relative links into HTML.
 */
export const llmSource = loader({
  baseUrl: "/docs",
  url: (slugs) => `${siteUrl}/docs${slugs.length > 0 ? `/${slugs.join("/")}` : ""}.md`,
  source: docs.toFumadocsSource(),
});
