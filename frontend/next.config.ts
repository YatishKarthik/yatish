import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,   // no Next.js "N" badge in the corner during development
  transpilePackages: ["three"],
  turbopack: {
    rules: {
      "globals.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;