import type { AppIconVariant } from "./app-icon";

/** Every app icon PNG `/icons/[file]` serves (manifest, layout, notifications; spec §10 PWA). */
export const ICON_FILES: Readonly<
  Record<string, { size: number; variant: AppIconVariant }>
> = {
  "icon-192.png": { size: 192, variant: "full" },
  "icon-512.png": { size: 512, variant: "full" },
  "maskable-512.png": { size: 512, variant: "maskable" },
  "apple-touch-icon.png": { size: 180, variant: "maskable" },
  "badge-96.png": { size: 96, variant: "badge" },
};

/**
 * The sizes inside `/favicon.ico`: the tab sizes, and 48 px, the smallest Google recommends going
 * past for its results (its favicon guidelines).
 */
export const FAVICON_SIZES = [16, 32, 48] as const;
