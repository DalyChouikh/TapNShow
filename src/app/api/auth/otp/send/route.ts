import type { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { apiError, ok } from "@/server/http/errors";
import {
  clientIp,
  parseJsonBody,
  rejectCrossOrigin,
} from "@/server/http/request";
import { allowOtpRequest } from "@/server/rate-limit/ip-rate-limit";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import { otpSendBodySchema } from "@/shared/api/auth";

/** Emails a sign-in code. Never reveals whether the address already has an account. */
export async function POST(request: Request): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const body = await parseJsonBody(request, otpSendBodySchema);
  if (!body.ok) {
    return body.response;
  }
  try {
    if (!(await allowOtpRequest(clientIp(request)))) {
      return apiError("rate_limited");
    }
  } catch (error) {
    logger.error({ err: error }, "otp ip rate limit failed");
    return apiError("internal");
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: body.data.email,
    options: { shouldCreateUser: true },
  });
  if (error) {
    if (error.status === 429) {
      return apiError("rate_limited");
    }
    logger.error({ err: error }, "signInWithOtp failed");
    return apiError("send_failed");
  }
  return ok();
}
