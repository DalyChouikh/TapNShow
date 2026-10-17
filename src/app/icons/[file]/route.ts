import { ICON_FILES } from "@/lib/brand/icon-files";
import { iconImage } from "@/lib/brand/icon-image";

export const dynamic = "force-static";
export const dynamicParams = false;

/** Every icon is drawn at build time. */
export function generateStaticParams(): { file: string }[] {
  return Object.keys(ICON_FILES).map((file) => ({ file }));
}

/** One app icon PNG (`ICON_FILES`). */
export async function GET(
  _request: Request,
  ctx: RouteContext<"/icons/[file]">,
): Promise<Response> {
  const spec = ICON_FILES[(await ctx.params).file];
  if (!spec) {
    return new Response(null, { status: 404 });
  }
  return iconImage(spec.variant, spec.size);
}
