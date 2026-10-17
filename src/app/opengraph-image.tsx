import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { APP_NAME } from "@/config/app";
import { SHARE_IMAGE, SHARE_IMAGE_LINE } from "@/config/share-image";
import { palette } from "@/design/tokens";
import { appIconDataUri } from "@/lib/brand/icon-image";

export const size = { width: SHARE_IMAGE.width, height: SHARE_IMAGE.height };
export const contentType = SHARE_IMAGE.type;
export const alt = SHARE_IMAGE.alt;

// The app's display face. ImageResponse can't use next/font and doesn't read woff2 (Next 16
// `image-response.md`, "Custom fonts"); self-hosted under the OFL (`OFL-archivo-black.txt`).
const archivoBlack = await readFile(
  join(process.cwd(), "src/assets/fonts/archivo-black-400.ttf"),
);

const ICON_SIZE = 176;

/**
 * The link preview image (spec §7.18; docs/superpowers/specs/2026-10-17-logo-design.md §4): the
 * mark and the name, then the product line, in Archivo Black. Its sentence is `Landing.title` in
 * `messages/en.json`: ImageResponse can't use next-intl, so change both together. Pages link it at
 * its versioned address (`SHARE_IMAGE_URL`).
 */
export default function OpengraphImage() {
  const { background, ink } = palette.light;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 44,
        padding: "0 84px",
        background,
        color: ink,
        fontFamily: "Archivo Black",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
        <img
          src={appIconDataUri("full")}
          width={ICON_SIZE}
          height={ICON_SIZE}
          alt=""
        />
        <div style={{ fontSize: 64 }}>{APP_NAME}</div>
      </div>
      <div style={{ fontSize: 68, lineHeight: 1.1 }}>{SHARE_IMAGE_LINE}</div>
    </div>,
    {
      ...size,
      fonts: [
        {
          name: "Archivo Black",
          data: archivoBlack,
          weight: 400,
          style: "normal",
        },
      ],
    },
  );
}
