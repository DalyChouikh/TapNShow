import type { Metadata } from "next";
import { APP_NAME } from "@/config/app";
import { DEFAULT_LOCALE, OPEN_GRAPH_LOCALES } from "@/config/i18n";
import { SHARE_IMAGE } from "@/config/share-image";
import type { LegalDocument } from "@/content/legal/types";
import { SHARE_IMAGE_URL } from "./share-image-url";

/**
 * Metadata for a public page (spec §7.18): its title and description, its own canonical address,
 * and a share card with the four properties ogp.me requires (title, type, image, url) plus the
 * site name and locale. The image is listed here because a page's `openGraph` replaces the one it
 * would inherit (Next merges metadata shallowly), at its versioned address (`SHARE_IMAGE_URL`);
 * relative paths resolve against `metadataBase`.
 */
export function publicPageMetadata(page: {
  path: string;
  title: string;
  description: string;
}): Metadata {
  const { path, title, description } = page;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      url: path,
      siteName: APP_NAME,
      locale: OPEN_GRAPH_LOCALES[DEFAULT_LOCALE],
      title,
      description,
      images: [{ ...SHARE_IMAGE, url: SHARE_IMAGE_URL }],
    },
  };
}

/** `publicPageMetadata` for a legal page: "<title> · TapNShow", its summary's first line. */
export function legalPageMetadata(
  document: LegalDocument,
  path: string,
): Metadata {
  return publicPageMetadata({
    path,
    title: `${document.title} · ${APP_NAME}`,
    description: document.summary[0],
  });
}
