import "server-only";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";

/**
 * Per-IP limit on sign-in code requests (limit in `private.app_limits`). Uses the secret key
 * because the caller is not signed in yet; `check_ip_rate_limit` is executable by
 * `service_role` only. Allowed admin-client caller per spec §11.
 * @throws Error when the database call fails
 */
export async function allowOtpRequest(ip: string): Promise<boolean> {
  const { data, error } = await createSupabaseAdminClient().rpc(
    "check_ip_rate_limit",
    { p_action: "otp_send", p_ip: ip },
  );
  if (error) {
    throw new Error(error.message);
  }
  return data === true;
}
