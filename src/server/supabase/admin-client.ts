import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/config/env";
import type { Database } from "@/server/db/database.types";

/**
 * Supabase client with the secret key — bypasses RLS. Allowed callers (spec §11):
 * the outbox dispatcher, the public token route, and the health probe.
 */
export function createSupabaseAdminClient(): SupabaseClient<Database> {
  const env = getServerEnv();
  return createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
