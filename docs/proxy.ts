/**
 * Serves docs pages as markdown to agents, two ways: an explicit `.md`/`.mdx` suffix, and an
 * `Accept: text/markdown` request for the plain page URL. Both rewrite to the markdown route under
 * `app/llms.mdx/docs`, so a browser still gets HTML from the same URL.
 */

import { isMarkdownPreferred, rewritePath } from "fumadocs-core/negotiation";
import { type NextRequest, NextResponse } from "next/server";

const mdxSuffix = rewritePath("/docs{/*path}.mdx", "/llms.mdx/docs{/*path}");
const mdSuffix = rewritePath("/docs{/*path}.md", "/llms.mdx/docs{/*path}");
const page = rewritePath("/docs{/*path}", "/llms.mdx/docs{/*path}");

export const config = {
  matcher: ["/docs", "/docs.md", "/docs.mdx", "/docs/:path*"],
};

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const suffixed = mdxSuffix.rewrite(pathname) || mdSuffix.rewrite(pathname);

  if (suffixed) return NextResponse.rewrite(new URL(suffixed, request.nextUrl));

  const negotiated = isMarkdownPreferred(request) && page.rewrite(pathname);

  if (negotiated) return NextResponse.rewrite(new URL(negotiated, request.nextUrl));

  return NextResponse.next();
}
