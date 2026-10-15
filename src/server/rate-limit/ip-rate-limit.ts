import "server-only";
import { logger } from "@/lib/logger";
import type { IpLimitAction } from "@/server/http/route-registry";
import { clientIp } from "@/server/http/request";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";

/** What a pre-sign-in route does next: go on, refuse (too many attempts), or fail closed. */
export type IpLimitVerdict = "allowed" | "limited" | "failed";

/**
 * Per-IP limit for a pre-sign-in route (limits in `private.app_limits`). Uses the secret key
 * because the caller is not signed in yet; `check_ip_rate_limit` is executable by `service_role`
 * only. Allowed admin-client caller per spec §11.
 * @throws Error when the database call fails
 */
export async function allowIpRequest(
  action: IpLimitAction,
  ip: string,
): Promise<boolean> {
  const { data, error } = await createSupabaseAdminClient().rpc(
    "check_ip_rate_limit",
    { p_action: action, p_ip: ip },
  );
  if (error) {
    throw new Error(error.message);
  }
  return data === true;
}

/**
 * The one per-IP check the pre-sign-in routes run (route registry `ip` rules): spends one unit for
 * the request's IP. A database failure is logged here and answered `failed`, so every route fails
 * closed the same way and only chooses how to say it.
 */
export async function checkIpLimit(
  action: IpLimitAction,
  request: Request,
): Promise<IpLimitVerdict> {
  try {
    return (await allowIpRequest(action, clientIp(request)))
      ? "allowed"
      : "limited";
  } catch (error) {
    logger.error({ err: error, action }, "ip rate limit check failed");
    return "failed";
  }
}
