import { ImageResponse } from "next/og";
import { type AppIconVariant, appIconSvg } from "./app-icon";

/** One square app icon PNG drawn from the single SVG source (`appIconSvg`), at build time. */
export function iconImage(
  variant: AppIconVariant,
  size: number,
): ImageResponse {
  const src = `data:image/svg+xml;base64,${Buffer.from(appIconSvg(variant)).toString("base64")}`;
  return new ImageResponse(
    // eslint-disable-next-line @next/next/no-img-element -- Satori draws plain <img>
    <img src={src} width={size} height={size} alt="" />,
    { width: size, height: size },
  );
}
