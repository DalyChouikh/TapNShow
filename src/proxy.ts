import type { NextRequest, NextResponse } from "next/server";
import { publicEnv } from "@/config/public-env";
import {
  CSP_HEADER,
  contentSecurityPolicy,
  reportingEndpoints,
} from "@/config/security-headers";
import { sentrySecurityEndpoint } from "@/lib/observability/sentry-security-endpoint";
import { updateSession } from "@/server/supabase/proxy-session";

/**
 * Next 16 proxy (formerly middleware): a fresh CSP nonce per request (Next reads it from the
 * forwarded CSP header and puts it on its own scripts; `x-nonce` is for our layout), and fresh
 * Supabase sessions.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const reportUri = sentrySecurityEndpoint(
    publicEnv.NEXT_PUBLIC_SENTRY_DSN,
    publicEnv.NEXT_PUBLIC_VERCEL_ENV ?? "development",
  );
  const policy = contentSecurityPolicy({
    nonce,
    development: process.env.NODE_ENV === "development",
    reportUri,
  });
  const extra = new Headers({ "x-nonce": nonce, [CSP_HEADER]: policy });
  const response = await updateSession(request, extra);
  response.headers.set(CSP_HEADER, policy);
  if (reportUri) {
    response.headers.set("Reporting-Endpoints", reportingEndpoints(reportUri));
  }
  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|serwist|icons|monitoring|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2)$).*)",
  ],
};
