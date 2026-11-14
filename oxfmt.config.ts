import { defineConfig } from "oxfmt";
import ultracite from "ultracite/oxfmt";

export default defineConfig({
  ...ultracite,
  /**
   * Vendored skills are pinned by hash in skills-lock.json, and release-please
   * regenerates the changelog on every release.
   */
  ignorePatterns: [
    ...(ultracite.ignorePatterns ?? []),
    ".agents",
    "packages/tui/CHANGELOG.md",
  ],
});
