import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  webpack: (config) => {
    // PDF.js canvas is not needed in browser mode
    config.resolve.alias.canvas = false
    config.resolve.alias.encoding = false
    return config
  },
};

export default nextConfig;
