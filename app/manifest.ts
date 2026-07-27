import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Field Ledger | JD Thornton Nurseries",
    short_name: "Field Ledger",
    description:
      "Farm-based tree inventory, irrigation zone, field work, and client order tracking.",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    background_color: "#f4f1e8",
    theme_color: "#183b32",
    orientation: "any",
    categories: ["business", "productivity"],
    icons: [
      {
        src: "/icons/192",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/512",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/512",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
