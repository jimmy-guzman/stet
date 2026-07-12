/**
 * Markdown rendition of a docs page, served to agents through `/llms-full.txt` and the per-page
 * `.md`/`.mdx` routes. `getText("processed")` is only populated because `source.config.ts` enables
 * `postprocess.includeProcessedMarkdown`; without it the pages compile to JSX with no markdown
 * left.
 *
 * Unlike `releases.ts`/`version.ts`, this flow has no safe fallback: its only failure is that
 * misconfiguration, so the build should fail rather than quietly publish empty pages.
 */

import { Data, Effect } from "effect";
import type { InferPageType } from "fumadocs-core/source";

import { siteUrl } from "@/lib/site";
import type { source } from "@/lib/source";

class LlmTextError extends Data.TaggedError("LlmTextError")<{ message: string }> {}

export function getLLMText(page: InferPageType<typeof source>) {
  return Effect.gen(function* () {
    const processed = yield* Effect.tryPromise({
      try: () => page.data.getText("processed"),
      catch: (cause) =>
        new LlmTextError({
          message: `${page.url}: ${cause instanceof Error ? cause.message : String(cause)}`,
        }),
    });

    return [
      `# ${page.data.title}`,
      `URL: ${new URL(page.url, siteUrl).toString()}`,
      "",
      page.data.description ?? "",
      "",
      processed.trim(),
    ].join("\n");
  });
}
