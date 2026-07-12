import { Effect } from "effect";

import { getLLMText } from "@/lib/llm";
import { source } from "@/lib/source";

export const revalidate = false;

export async function GET() {
  const pages = await Effect.runPromise(
    Effect.forEach(source.getPages(), getLLMText, { concurrency: 5 }),
  );

  return new Response(pages.join("\n\n"));
}
