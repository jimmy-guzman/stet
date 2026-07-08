import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";

import { Logo } from "@/components/logo";

export function baseOptions(version?: string): BaseLayoutProps {
  return {
    nav: {
      title: <Logo version={version} />,
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
