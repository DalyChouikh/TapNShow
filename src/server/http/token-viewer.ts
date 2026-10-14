import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import type { Database } from "@/server/db/database.types";
import { hasAuthCookie } from "@/server/http/auth-cookie";
import { requireUser } from "@/server/http/require-user";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import { type TokenViewer, tokenViewerSchema } from "@/shared/api/tokens";

/**
 * Who is looking at a personal link (spec §7.4): signed out, the invite's own verified account
 * ("Back to my invites"), or someone else. Never fails the page: a lookup error counts as "other".
 */
export async function tokenViewer(
  request: Request,
  admin: SupabaseClient<Database>,
  tokenHash: string,
): Promise<TokenViewer> {
  if (!hasAuthCookie(request)) {
    return "signed_out";
  }
  const user = await requireUser(await createSupabaseServerClient());
  if (!user) {
    return "signed_out";
  }
  const { data, error } = await admin.rpc("token_viewer", {
    p_token_hash: tokenHash,
    p_user: user.id,
  });
  if (error) {
    logger.warn({ code: error.code }, "token viewer lookup failed");
    return "other";
  }
  return tokenViewerSchema.parse(data);
}
