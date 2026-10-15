import { ImageResponse } from "next/og";
import { APP_NAME } from "@/config/app";
import { palette } from "@/design/tokens";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
/** Same words as `Landing.title` (keep both in step). */
const LINE = "Know who's coming before the meeting starts.";

export const alt = `${APP_NAME}: ${LINE}`;

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
        {LINE}
      </div>
    </div>,
    size,
  );
}
