import { defineConfig, defineDocs } from "fumadocs-mdx/config";

import { stetDark, stetLight } from "./lib/code-theme";
import { markdownImage } from "./lib/llm-image";

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    postprocess: {
      includeProcessedMarkdown: {
        stringify: markdownImage,
      },
    },
  },
});

export default defineConfig({
  mdxOptions: {
    remarkImageOptions: {
      // remarkImage rewrites every image to a bundler import, which the markdown output can only
      // stringify as its variable name (`src="__img0"`). Keeping the literal path is what lets
      // `markdownImage` emit a real image an agent can fetch.
      useImport: false,
    },
    rehypeCodeOptions: {
      themes: {
        light: stetLight,
        dark: stetDark,
      },
    },
  },
});
