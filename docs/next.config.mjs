import path from "node:path";

import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import("next").NextConfig} */
const config = {
  reactStrictMode: true,
  turbopack: {
    root: path.join(import.meta.dirname, ".."),
  },
  async redirects() {
    return [
      {
        source: "/install",
        destination: "https://raw.githubusercontent.com/jimmy-guzman/stet/main/install.sh",
        permanent: false,
      },
    ];
  },
};

export default withMDX(config);
