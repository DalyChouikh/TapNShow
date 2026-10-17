import { palette } from "@/design/tokens";

/**
 * The drawings the icon route turns into PNGs (spec §10 PWA): `full` rounded on the mint tile,
 * `square` and `maskable` full bleed, `badge` one colour for notifications.
 */
export type AppIconVariant = "full" | "square" | "maskable" | "badge";

/**
 * The calendar mark on the 512 grid, before a variant's scale
 * (docs/superpowers/specs/2026-10-17-logo-design.md §2).
 */
export const MARK = {
  page: { x: 104, y: 120, width: 304, height: 284, radius: 56 },
  topLineY: 200,
  ringXs: [170, 302],
  ring: { y: 84, width: 40, height: 84, radius: 20 },
  check: "M196 300l40 40 80-84",
  checkWidth: 40,
  outline: 22,
  shadow: 20,
  tilt: -8,
} as const;

/** How large each canvas draws the mark (design §3); every value keeps it in the safe circle. */
export const VARIANT_SCALE: Readonly<
  Record<Exclude<AppIconVariant, "badge">, number>
> = { full: 0.86, square: 0.86, maskable: 0.72 };

/** The badge's line widths, heavier than the mark's so 24 px stays readable (design §3). */
const BADGE = { outline: 34, topLine: 30, ringGrow: 8, check: 46 } as const;

const CENTRE = 256;
const FULL_RADIUS = 112;
const { ink, primary, success, surface } = palette.light;
const { page, ring } = MARK;
const pageRight = page.x + page.width;
const pageRect = `<rect x="${page.x}" y="${page.y}" width="${page.width}" height="${page.height}" rx="${page.radius}"/>`;
const tilt = `rotate(${MARK.tilt} ${CENTRE} ${CENTRE})`;

/** The two ring pills, filled `colour`, `grow` wider and taller around their own centres. */
function rings(colour: string, grow = 0): string {
  return MARK.ringXs
    .map(
      (x) =>
        `<rect x="${x - grow / 2}" y="${ring.y - grow / 2}" width="${ring.width + grow}" height="${ring.height + grow}" rx="${ring.radius + grow / 2}" fill="${colour}"/>`,
    )
    .join("");
}

function line(d: string, colour: string, width: number): string {
  return `<path d="${d}" fill="none" stroke="${colour}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
}

const topLine = `M${page.x} ${MARK.topLineY}H${pageRight}`;

/** The sticker: ink shadow, ink outline, white page, lilac top, top line, rings, check. */
const MARK_SVG = [
  `<g transform="translate(0 ${MARK.shadow})" fill="${ink}" stroke="${ink}" stroke-width="${2 * MARK.outline}" stroke-linejoin="round">${pageRect}</g>`,
  `<g fill="${ink}" stroke="${ink}" stroke-width="${2 * MARK.outline}" stroke-linejoin="round">${pageRect}</g>`,
  `<g fill="${surface}">${pageRect}</g>`,
  `<path d="M${page.x} ${MARK.topLineY}V${page.y + page.radius}A${page.radius} ${page.radius} 0 0 1 ${page.x + page.radius} ${page.y}H${pageRight - page.radius}A${page.radius} ${page.radius} 0 0 1 ${pageRight} ${page.y + page.radius}V${MARK.topLineY}Z" fill="${primary}"/>`,
  `<path d="${topLine}" stroke="${ink}" stroke-width="${MARK.outline}"/>`,
  rings(ink),
  line(MARK.check, ink, MARK.checkWidth),
].join("");

/** Notification badge: the mark as white lines, alpha only (W3C manifest, monochrome). */
const BADGE_SVG = [
  `<rect x="${page.x}" y="${page.y}" width="${page.width}" height="${page.height}" rx="${page.radius}" fill="none" stroke="#FFFFFF" stroke-width="${BADGE.outline}"/>`,
  `<path d="${topLine}" stroke="#FFFFFF" stroke-width="${BADGE.topLine}"/>`,
  rings("#FFFFFF", BADGE.ringGrow),
  line(MARK.check, "#FFFFFF", BADGE.check),
].join("");

/**
 * The farthest any drawn point gets from the centre at scale 1. Turning around the centre keeps
 * distances, so the tilt doesn't change it; each rounded corner reaches its circle's centre
 * distance plus its radius (the page's corners with the outline, again moved down by the shadow,
 * and the rings').
 */
export function markRadius(): number {
  const reach = (x: number, y: number, radius: number) =>
    Math.hypot(x - CENTRE, y - CENTRE) + radius;
  const corners = (
    box: { x: number; y: number; width: number; height: number },
    r: number,
  ) =>
    [box.x + r, box.x + box.width - r].flatMap((x) =>
      [box.y + r, box.y + box.height - r].map((y) => [x, y] as const),
    );
  const pageReach = corners(page, page.radius).flatMap(([x, y]) => [
    reach(x, y, page.radius + MARK.outline),
    reach(x, y + MARK.shadow, page.radius + MARK.outline),
  ]);
  const ringReach = MARK.ringXs.flatMap((x) =>
    corners({ ...ring, x }, ring.radius).map(([cx, cy]) =>
      reach(cx, cy, ring.radius),
    ),
  );
  return Math.max(...pageReach, ...ringReach);
}

/**
 * The calendar mark as SVG (docs/superpowers/specs/2026-10-17-logo-design.md): `full` on a rounded
 * mint tile (favicon, `any` icons, `BrandMark`), `square` full bleed (Apple, Google Cloud),
 * `maskable` full bleed and smaller (Android crops it), `badge` white lines for the status bar.
 */
export function appIconSvg(variant: AppIconVariant): string {
  const open = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">';
  if (variant === "badge") {
    return `${open}<g transform="${tilt}">${BADGE_SVG}</g></svg>`;
  }
  const scale = `translate(${CENTRE} ${CENTRE}) scale(${VARIANT_SCALE[variant]}) translate(-${CENTRE} -${CENTRE})`;
  const corner = variant === "full" ? ` rx="${FULL_RADIUS}"` : "";
  return `${open}<rect width="512" height="512"${corner} fill="${success}"/><g transform="${scale}"><g transform="${tilt}">${MARK_SVG}</g></g></svg>`;
}
