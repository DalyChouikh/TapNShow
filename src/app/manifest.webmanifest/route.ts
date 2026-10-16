import { webManifest } from "@/config/web-manifest";

export const dynamic = "force-static";

/**
 * `/manifest.webmanifest` (spec §10 PWA). A route instead of Next's `manifest.ts` convention, whose
 * link asks for credentials on preview deployments only: a production deployment's own URL is
 * behind Vercel's login too, so the manifest fetched without its cookie was redirected to another
 * origin and the CSP refused it. The root layout links this with credentials everywhere.
 */
export function GET(): Response {
  return Response.json(webManifest(), {
    headers: { "content-type": "application/manifest+json" },
  });
}
