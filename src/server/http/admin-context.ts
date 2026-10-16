import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import type { Database } from "@/server/db/database.types";
import { myPlatformRole } from "@/server/queries/admin";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import { apiError, fromDatabaseError, ok } from "./errors";
import { requireUser, type AuthedUser } from "./require-user";

/** Everything an `/api/admin/**` handler needs, or the response to return. */
export type AdminContext =
  | {
      ok: true;
      supabase: SupabaseClient<Database>;
      user: AuthedUser;
      role: "owner" | "admin";
    }
  | { ok: false; response: NextResponse };

/**
 * Session + platform role (spec §7.19): signed out → 401; signed in but not a platform admin → 404,
 * so the admin area never reveals it exists. The database functions check the role again.
 */
export async function loadAdminContext(): Promise<AdminContext> {
  const supabase = await createSupabaseServerClient();
  const user = await requireUser(supabase);
  if (!user) {
    return { ok: false, response: apiError("unauthenticated") };
  }
  const role = await myPlatformRole(supabase);
  return role
    ? { ok: true, supabase, user, role }
    : { ok: false, response: apiError("not_found") };
}

/** An admin query's answer as the response: its data as JSON, or its database error mapped. */
export function adminJson<T>(
  result:
    | { data: T; error: null }
    | { data: null; error: { code?: string; message: string } },
): NextResponse {
  return result.error
    ? fromDatabaseError(result.error)
    : NextResponse.json(result.data);
}

/** An admin write's answer as the response: `{ ok: true }`, or its database error mapped. */
export function adminOk(result: {
  error: { code?: string; message: string } | null;
}): NextResponse {
  return result.error ? fromDatabaseError(result.error) : ok();
}
