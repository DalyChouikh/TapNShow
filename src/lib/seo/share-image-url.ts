import { createHash } from "node:crypto";
import { APP_NAME } from "@/config/app";
import { SHARE_IMAGE, SHARE_IMAGE_LINE } from "@/config/share-image";
import { appIconSvg } from "@/lib/brand/app-icon";

/** A short digest of what a picture shows: the same parts give the same version. */
export function shareImageVersion(parts: readonly string[]): string {
  return createHash("sha256")
    .update(parts.join("\n"))
    .digest("hex")
    .slice(0, 10);
}

/**
 * The link preview's address, versioned by the mark, the name and the line it shows
 * (docs/superpowers/specs/2026-10-17-logo-design.md §4). Meta caches a shared image by its URL, so
 * a new picture gets a new address; the route ignores the query, so older shares keep working.
 */
export const SHARE_IMAGE_URL = `${SHARE_IMAGE.url}?v=${shareImageVersion([
  appIconSvg("full"),
  APP_NAME,
  SHARE_IMAGE_LINE,
])}`;

/** The share card's image entry at its versioned address, for every page's `openGraph.images`. */
export const VERSIONED_SHARE_IMAGE = { ...SHARE_IMAGE, url: SHARE_IMAGE_URL };
