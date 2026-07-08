import { defineConfig, defineDocs } from "fumadocs-mdx/config";

import { stetDark, stetLight } from "./lib/code-theme";

export const docs = defineDocs({
  dir: "content/docs",
});

export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: {
      themes: {
        light: stetLight,
        dark: stetDark,
      },
    },
  },
});
