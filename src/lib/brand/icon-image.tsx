import { ImageResponse } from "next/og";
import { type AppIconVariant, appIconSvg } from "./app-icon";

/** The icon's SVG as a data URI, the form Satori draws in an `<img>` (icons and the link preview). */
export function appIconDataUri(variant: AppIconVariant): string {
  return `data:image/svg+xml;base64,${Buffer.from(appIconSvg(variant)).toString("base64")}`;
}

/** One square app icon PNG drawn from the single SVG source (`appIconSvg`), at build time. */
export function iconImage(
  variant: AppIconVariant,
  size: number,
): ImageResponse {
  return new ImageResponse(
    // eslint-disable-next-line @next/next/no-img-element -- Satori draws plain <img>
    <img src={appIconDataUri(variant)} width={size} height={size} alt="" />,
    { width: size, height: size },
  );
}
