import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Static export ONLY when building for GitHub Pages
  ...(isGitHubPages ? { output: "export" } : {}),
};

export default nextConfig;