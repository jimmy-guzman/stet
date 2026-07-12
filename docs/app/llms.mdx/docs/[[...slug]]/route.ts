import { Effect } from "effect";
import { notFound } from "next/navigation";

import { getLLMText } from "@/lib/llm";
import { source } from "@/lib/source";

interface RouteProps {
  params: Promise<{ slug?: string[] }>;
}

export const revalidate = false;

export async function GET(_request: Request, props: RouteProps) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  return new Response(await Effect.runPromise(getLLMText(page)), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}

export function generateStaticParams() {
  return source.generateParams();
}
