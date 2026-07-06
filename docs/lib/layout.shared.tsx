import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <span className="font-mono text-base font-semibold tracking-tight">stet</span>,
    },
    githubUrl: "https://github.com/jimmy-guzman/stet",
    links: [
      {
        text: "Docs",
        url: "/docs",
      },
    ],
  };
}
