import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/site";
import { source } from "@/lib/source";

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = source.getPages().map((page) => ({
    url: new URL(page.url, siteUrl).toString(),
  }));

  return [{ url: siteUrl }, ...pages];
}
