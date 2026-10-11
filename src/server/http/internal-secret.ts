import "server-only";
import type { NextResponse } from "next/server";
import { getServerEnv } from "@/config/env";
import { tokensEqual } from "@/server/crypto/tokens";
import { apiError } from "@/server/http/errors";

/**
 * The Bearer check of internal routes (Supabase Cron only, spec §8); null when the caller may pass.
 * Without a configured secret the route answers 404, as if it did not exist.
 */
export function requireInternalSecret(request: Request): NextResponse | null {
  const secret = getServerEnv().DISPATCH_SECRET;
  if (!secret) {
    return apiError("not_found");
  }
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  return tokensEqual(provided, secret) ? null : apiError("unauthenticated");
}
