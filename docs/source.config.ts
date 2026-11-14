import { defineConfig, defineDocs } from "fumadocs-mdx/config";

import { stetDark, stetLight } from "./lib/code-theme";
import { remarkAbsoluteImages } from "./lib/llm-image";

export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
});

export default defineConfig({
  mdxOptions: {
    remarkPlugins: [remarkAbsoluteImages],
    remarkImageOptions: {
      // remarkImage rewrites every image to a bundler import, deleting the node's `url`. It runs
      // before `remarkPlugins`, so keeping the literal path is what lets `remarkAbsoluteImages`
      // find the image and emit a URL an agent can fetch.
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
