import type { NextConfig } from "next";

// CELESTRA_EXPORT=1 builds a static site (frontend/out) that the backend serves in the deployed container.
const exportSite = process.env.CELESTRA_EXPORT === "1";

const nextConfig: NextConfig = {
  ...(exportSite ? { output: "export" as const, images: { unoptimized: true } } : {}),
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