import type { AppIconVariant } from "./app-icon";

/** Every app icon PNG `/icons/[file]` serves (manifest, layout, notifications; spec §10 PWA). */
export const ICON_FILES: Readonly<
  Record<string, { size: number; variant: AppIconVariant }>
> = {
  "icon-192.png": { size: 192, variant: "full" },
  "icon-512.png": { size: 512, variant: "full" },
  "maskable-512.png": { size: 512, variant: "maskable" },
  "apple-touch-icon.png": { size: 180, variant: "maskable" },
  "favicon-32.png": { size: 32, variant: "full" },
  "badge-96.png": { size: 96, variant: "badge" },
};
