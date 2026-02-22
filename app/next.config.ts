import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";
const repoName = "Gielda-MPV";

const nextConfig: NextConfig = {
  // GitHub Pages = static export
  ...(isGitHubPages ? { output: "export" } : {}),

  // GitHub Pages = repo subpath
  ...(isGitHubPages
    ? {
        basePath: `/${repoName}`,
        assetPrefix: `/${repoName}/`,
      }
    : {}),

  images: {
    unoptimized: true,
  },
};

export default nextConfig;