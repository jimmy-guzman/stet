import { defineConfig } from "oxlint";
import antiSlop from "ultracite/oxlint/anti-slop";
import core from "ultracite/oxlint/core";

export default defineConfig({
  env: core.env,
  extends: [core, antiSlop],
  /** Vendored skills are pinned by hash in skills-lock.json. */
  ignorePatterns: [...(core.ignorePatterns ?? []), ".agents"],
  options: { typeAware: true },
});
