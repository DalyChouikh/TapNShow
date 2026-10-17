import { APP_NAME } from "./app";

/**
 * The link preview's sentence: `Landing.title` in `messages/en.json` (ImageResponse can't use
 * next-intl; a test pins the twin).
 */
export const SHARE_IMAGE_LINE = "Know who's coming before the meeting starts.";

/**
 * The link preview image (`app/opengraph-image.tsx`, spec §7.18), as every public page's share
 * card names it. A page that sets `openGraph` replaces what it would inherit (Next merges metadata
 * shallowly), so the card lists the image itself.
 */
export const SHARE_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  type: "image/png",
  alt: `${APP_NAME}: ${SHARE_IMAGE_LINE}`,
} as const;
