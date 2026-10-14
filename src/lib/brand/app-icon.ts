import { palette } from "@/design/tokens";

/** The three drawings the icon route turns into PNGs (spec §10 PWA; icon "B", owner 2026-10-14). */
export type AppIconVariant = "full" | "maskable" | "badge";

const { background, ink, success } = palette.light;
const TILE = `<rect x="104" y="100" width="304" height="304" rx="72" fill="${ink}"/><rect x="104" y="84" width="304" height="304" rx="72" fill="${success}" stroke="${ink}" stroke-width="20"/><path d="M168 240l60 60 116-116" fill="none" stroke="${ink}" stroke-width="40" stroke-linecap="round" stroke-linejoin="round"/>`;

/**
 * The tilted green "confirmed" tile (the mockup's option B) as SVG: `full` on the app background
 * with rounded corners, `maskable` full-bleed with the tile inside Android's safe zone, `badge` a
 * white silhouette for Android's notification bar.
 */
export function appIconSvg(variant: AppIconVariant): string {
  const open = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">';
  if (variant === "badge") {
    return `${open}<g transform="rotate(-8 256 256)"><rect x="104" y="84" width="304" height="304" rx="72" fill="none" stroke="#FFFFFF" stroke-width="28"/><path d="M168 240l60 60 116-116" fill="none" stroke="#FFFFFF" stroke-width="44" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;
  }
  const tile = `<g transform="rotate(-8 256 256)">${TILE}</g>`;
  return variant === "maskable"
    ? `${open}<rect width="512" height="512" fill="${background}"/><g transform="translate(64 64) scale(0.75)">${tile}</g></svg>`
    : `${open}<rect width="512" height="512" rx="112" fill="${background}"/>${tile}</svg>`;
}
