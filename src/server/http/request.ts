import "server-only";
import type { NextResponse } from "next/server";
import type { z } from "zod";
import { apiError } from "./errors";

/**
 * CSRF guard for mutations (Server Actions' built-in check is not used): the Origin header
 * must equal the request's own origin; without Origin, `Sec-Fetch-Site: same-origin` is required.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin) {
    return origin === new URL(request.url).origin;
  }
  return request.headers.get("sec-fetch-site") === "same-origin";
}

/** Returns a 403 response for cross-origin mutations, or null when the request may continue. */
export function rejectCrossOrigin(request: Request): NextResponse | null {
  return isSameOrigin(request) ? null : apiError("invalid_origin");
}

/** Parses and validates a JSON body; malformed or invalid bodies become `400 invalid_input`. */
export async function parseJsonBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  try {
    const parsed = schema.safeParse(await request.json());
    return parsed.success
      ? { ok: true, data: parsed.data }
      : { ok: false, response: apiError("invalid_input") };
  } catch {
    return { ok: false, response: apiError("invalid_input") };
  }
}

/** Client IP as set by Vercel (which overwrites client-supplied forwarding headers). */
export function clientIp(request: Request): string {
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  return request.headers.get("x-real-ip") ?? (forwarded || "unknown");
}
