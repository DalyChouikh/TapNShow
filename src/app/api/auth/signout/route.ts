import type { NextResponse } from "next/server";
import { ok } from "@/server/http/errors";
import { rejectCrossOrigin } from "@/server/http/request";
import { createSupabaseServerClient } from "@/server/supabase/server-client";

/** Ends the session on this device. */
export async function POST(request: Request): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
  return ok();
}
