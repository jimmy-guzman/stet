import { Banner } from "fumadocs-ui/components/banner";
import Link from "next/link";

/**
 * The docs deploy from `main` on every push while the package release is gated to `packages/tui`,
 * so the docs can describe behavior that is not yet in the installable version. This states that
 * plainly and points at the release-accurate changelog; the nav badge carries the published
 * version.
 */
export function DevBanner({ version }: { version?: string }) {
  return (
    <Banner id="stet-docs-next">
      <span>
        These docs track the development version of stet, which may be ahead of the current release
        {version ? ` (v${version})` : ""}.{" "}
        <Link href="/changelog" className="font-medium underline underline-offset-2">
          See the changelog
        </Link>
        .
      </span>
    </Banner>
  );
}
