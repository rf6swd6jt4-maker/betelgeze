import type { MetadataRoute } from "next";

const icons = [
  {
    src: "/icons/betelgeze-icon-192.png",
    sizes: "192x192",
    type: "image/png",
  },
  {
    src: "/icons/betelgeze-icon-512.png",
    sizes: "512x512",
    type: "image/png",
  },
];

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Betelgeze",
    short_name: "Betelgeze",
    description: "The private operating system for Scaylup client work.",
    lang: "en",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    categories: ["business", "productivity"],
    icons: [
      ...icons.map((icon) => ({ ...icon, purpose: "any" as const })),
      { ...icons[1], purpose: "maskable" },
    ],
    launch_handler: {
      client_mode: "focus-existing",
    },
    shortcuts: [
      {
        name: "Lead Gen",
        short_name: "Lead Gen",
        description: "Open Betelgeze lead generation.",
        url: "/leadgen",
        icons,
      },
      {
        name: "Workspaces",
        short_name: "Workspaces",
        description: "Open your Betelgeze workspaces.",
        url: "/workspaces",
        icons,
      },
      {
        name: "Install",
        short_name: "Install",
        description: "Install Betelgeze on this device.",
        url: "/install",
        icons,
      },
    ],
  };
}
