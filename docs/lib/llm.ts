/**
 * Markdown rendition of a docs page, served to agents through `/llms-full.txt` and the per-page
 * `.md`/`.mdx` routes. `getText("processed")` is only populated because `source.config.ts` enables
 * `postprocess.includeProcessedMarkdown`; without it the pages compile to JSX with no markdown
 * left.
 *
 * Unlike `releases.ts`/`version.ts`, this flow has no safe fallback. Every failure it wraps is a
 * defect in the content or the config (that misconfiguration, or a page whose compiled module fails
 * to load), never a transient outage, so the build should fail rather than quietly publish empty
 * pages.
 */

import type { InferPageType } from "fumadocs-core/source";

import { siteUrl } from "@/lib/site";
import type { source } from "@/lib/source";

type Page = InferPageType<typeof source>;

const processedText = async (page: Page) => {
  try {
    return await page.data.getText("processed");
  } catch (error) {
    throw new Error(
      `${page.url}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
};

export const getLLMText = async (page: Page) => {
  const processed = await processedText(page);

  return [
    `# ${page.data.title}`,
    `URL: ${new URL(page.url, siteUrl).toString()}`,
    "",
    page.data.description ?? "",
    "",
    processed.trim(),
  ].join("\n");
};
