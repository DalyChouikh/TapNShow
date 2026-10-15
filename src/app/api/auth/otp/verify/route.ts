import type { NextResponse } from "next/server";
import { apiError, ok } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { checkIpLimit } from "@/server/rate-limit/ip-rate-limit";
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
  // Per IP before the code is checked: guessing codes costs attempts (spec §11).
  const verdict = await checkIpLimit("otp_verify", request);
  if (verdict !== "allowed") {
    return apiError(verdict === "limited" ? "rate_limited" : "internal");
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
