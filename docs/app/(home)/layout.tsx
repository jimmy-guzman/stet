import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { ReactNode } from "react";

import { baseOptions } from "@/lib/layout.shared";
import { getStetVersion } from "@/lib/version";

import { Footer } from "./footer";

export default async function Layout({ children }: { children: ReactNode }) {
  const version = await getStetVersion();

  return (
    <HomeLayout {...baseOptions(version)}>
      {children}
      <Footer version={version} />
    </HomeLayout>
  );
}
