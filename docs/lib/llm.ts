/**
 * Markdown rendition of a docs page, served to agents through `/llms-full.txt` and the per-page
 * `.md`/`.mdx` routes. `getText("processed")` is only populated because `source.config.ts` enables
 * `postprocess.includeProcessedMarkdown`; without it the pages compile to JSX with no markdown
 * left.
 */

import type { InferPageType } from "fumadocs-core/source";

import { siteUrl } from "@/lib/site";
import type { source } from "@/lib/source";

export async function getLLMText(page: InferPageType<typeof source>) {
  const processed = await page.data.getText("processed");

  return [
    `# ${page.data.title}`,
    `URL: ${new URL(page.url, siteUrl).toString()}`,
    "",
    page.data.description ?? "",
    "",
    processed.trim(),
  ].join("\n");
}
