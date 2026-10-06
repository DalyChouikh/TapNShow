import type { NextResponse } from "next/server";
import { apiError, ok } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import { otpVerifyBodySchema } from "@/shared/api/auth";

/** Exchanges an emailed code for a session (cookies are set by the server client). */
export async function POST(request: Request): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const body = await parseJsonBody(request, otpVerifyBodySchema);
  if (!body.ok) {
    return body.response;
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.verifyOtp({
    email: body.data.email,
    token: body.data.code,
    type: "email",
  });
  if (error) {
    return apiError(error.status === 429 ? "rate_limited" : "invalid_code");
  }
  return ok();
}
