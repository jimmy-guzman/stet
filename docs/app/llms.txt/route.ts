import { llms } from "fumadocs-core/source";

import { siteUrl } from "@/lib/site";
import { llmSource } from "@/lib/source";

export const revalidate = false;

export function GET() {
  const pages = llms(llmSource);

  const index = [
    "# stet",
    "",
    "> A read-only companion TUI for CLI coding agents. Run an agent in one terminal pane and stet in the next to inspect what changed: the repo, the diff, and the problems. It only inspects, so it never reviews, approves, or talks to the agent.",
    "",
    "## Docs",
    "",
    ...llmSource.getPageTree().children.map((child) => pages.indexNode(child)),
    "",
    "## Optional",
    "",
    `- [Full documentation](${siteUrl}/llms-full.txt): every docs page as one markdown file`,
    `- [Changelog](${siteUrl}/changelog): release history`,
    "",
  ].join("\n");

  return new Response(index);
}
