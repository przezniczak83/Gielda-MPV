import type { NextConfig } from "next";

const repoName = "Gielda-MPV";

// Vercel zawsze ustawia VERCEL=1 w build/runtime
const isVercel = process.env.VERCEL === "1";

// Tryb GitHub Pages ma działać TYLKO poza Vercel
// (żeby nigdy nie wymusić `output: "export"` ani `basePath` na Vercel)
const isGitHubPages = !isVercel && process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  // GitHub Pages: static export
  ...(isGitHubPages ? { output: "export" as const } : {}),

  // GitHub Pages: repo subpath
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