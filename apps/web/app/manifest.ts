import type { MetadataRoute } from "next";

/** Web app manifest (served at /manifest.webmanifest): makes the site installable as an app. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Alarm Filter",
    short_name: "Alarms",
    description: "Mobile network alarm monitor",
    id: "/alarms",
    start_url: "/alarms",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0f1b2d",
    theme_color: "#0f1b2d",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Alarms", url: "/alarms", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      {
        name: "Cleared",
        url: "/cleared",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      {
        name: "Dashboard",
        url: "/dashboard",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
    ],
  };
}
