import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";

import { DevBanner } from "@/components/dev-banner";
import { baseOptions } from "@/lib/layout.shared";
import { source } from "@/lib/source";
import { getStetVersion } from "@/lib/version";

export default async function Layout({ children }: { children: ReactNode }) {
  const version = await getStetVersion();

  return (
    <>
      <DevBanner version={version} />
      <DocsLayout tree={source.getPageTree()} {...baseOptions(version)}>
        {children}
      </DocsLayout>
    </>
  );
}
