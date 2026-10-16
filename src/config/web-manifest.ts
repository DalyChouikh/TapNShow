import type { MetadataRoute } from "next";
import { APP_DESCRIPTION, APP_NAME } from "@/config/app";
import { palette } from "@/design/tokens";

/**
 * The web app manifest (spec §10 PWA): installs TapNShow with My invites as its start page. Served
 * by `src/app/manifest.webmanifest/route.ts` and linked by the root layout.
 */
export function webManifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: APP_DESCRIPTION,
    start_url: "/invites",
    scope: "/",
    display: "standalone",
    background_color: palette.light.background,
    theme_color: palette.light.background,
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
