import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import type { Database } from "@/server/db/database.types";
import { inviteeTokenHash } from "@/server/crypto/invitee-token";
import { checkTokenRateLimit } from "@/server/queries/tokens";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";
import { TOKEN_PATTERN } from "@/shared/api/tokens";
import { apiError, fromDatabaseError } from "./errors";
import { clientIp } from "./request";

/** A public token request that may proceed (service-role client; spec §11 allowed caller). */
export type TokenContext =
  | { ok: true; client: SupabaseClient<Database>; tokenHash: string }
  | { ok: false; response: NextResponse };

/**
 * Validates the token's shape (a malformed token looks exactly like an unknown one: 404), hashes it,
 * and spends the per-IP and per-token budgets before any lookup.
 */
export async function loadTokenContext(
  request: Request,
  token: string,
): Promise<TokenContext> {
  if (!TOKEN_PATTERN.test(token)) {
    return { ok: false, response: apiError("not_found") };
  }
  const client = createSupabaseAdminClient();
  const tokenHash = inviteeTokenHash(token);
  const allowed = await checkTokenRateLimit(
    client,
    clientIp(request),
    tokenHash,
  );
  if (allowed.error) {
    return { ok: false, response: fromDatabaseError(allowed.error) };
  }
  return allowed.data
    ? { ok: true, client, tokenHash }
    : { ok: false, response: apiError("rate_limited") };
}
