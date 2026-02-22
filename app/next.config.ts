import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  basePath: "/Gielda-MPV",
  assetPrefix: "/Gielda-MPV/",
  images: {
    unoptimized: true,
  },
};

export default nextConfig;