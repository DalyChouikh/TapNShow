import { ImageResponse } from "next/og";
import { APP_NAME } from "@/config/app";
import { SHARE_IMAGE, SHARE_IMAGE_LINE } from "@/config/share-image";
import { palette } from "@/design/tokens";

export const size = { width: SHARE_IMAGE.width, height: SHARE_IMAGE.height };
export const contentType = SHARE_IMAGE.type;
export const alt = SHARE_IMAGE.alt;

/**
 * The link preview image (spec §7.18). Text only until the new logo exists. Its sentence is
 * `Landing.title` in `messages/en.json`: ImageResponse can't use next-intl, so change both together.
 */
export default function OpengraphImage() {
  const { background, ink, primary } = palette.light;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: 80,
        background,
        color: ink,
      }}
    >
      <div
        style={{
          fontSize: 40,
          fontWeight: 700,
          background: primary,
          padding: "8px 20px",
          borderRadius: 16,
          border: `6px solid ${ink}`,
          alignSelf: "flex-start",
        }}
      >
        {APP_NAME}
      </div>
      <div
        style={{
          fontSize: 76,
          fontWeight: 800,
          marginTop: 40,
          lineHeight: 1.1,
        }}
      >
        {SHARE_IMAGE_LINE}
      </div>
    </div>,
    size,
  );
}
