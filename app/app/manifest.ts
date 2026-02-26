import { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name:             "Giełda Monitor",
    short_name:       "GM Terminal",
    description:      "Terminal analityczny GPW + USA",
    start_url:        "/",
    display:          "standalone",
    background_color: "#111827",
    theme_color:      "#10b981",
    orientation:      "landscape",
    categories:       ["finance", "business"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
