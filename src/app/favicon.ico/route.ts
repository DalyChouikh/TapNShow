import { FAVICON_SIZES } from "@/lib/brand/icon-files";
import { encodeIco } from "@/lib/brand/ico";
import { iconImage } from "@/lib/brand/icon-image";

export const dynamic = "force-static";

/**
 * `/favicon.ico`, drawn at build time from the same source as every other icon, so a new logo
 * changes it too. Bing and many browsers ask for this address whatever the page links; Next's
 * `favicon.ico` file convention can't be generated, so this is a route.
 */
export async function GET(): Promise<Response> {
  const images = await Promise.all(
    FAVICON_SIZES.map(async (size) => ({
      size,
      png: new Uint8Array(await iconImage("full", size).arrayBuffer()),
    })),
  );
  return new Response(encodeIco(images), {
    headers: { "Content-Type": "image/x-icon" },
  });
}
