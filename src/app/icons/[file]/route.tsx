import { ImageResponse } from "next/og";
import { appIconSvg } from "@/lib/brand/app-icon";
import { ICON_FILES } from "@/lib/brand/icon-files";

export const dynamic = "force-static";
export const dynamicParams = false;

/** Every icon is drawn at build time. */
export function generateStaticParams(): { file: string }[] {
  return Object.keys(ICON_FILES).map((file) => ({ file }));
}

/** One app icon PNG, drawn from the single SVG source (`appIconSvg`). */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/icons/[file]">,
): Promise<Response> {
  const spec = ICON_FILES[(await ctx.params).file];
  if (!spec) {
    return new Response(null, { status: 404 });
  }
  const src = `data:image/svg+xml;base64,${Buffer.from(appIconSvg(spec.variant)).toString("base64")}`;
  return new ImageResponse(
    // eslint-disable-next-line @next/next/no-img-element -- Satori draws plain <img>
    <img src={src} width={spec.size} height={spec.size} alt="" />,
    { width: spec.size, height: spec.size },
  );
}
