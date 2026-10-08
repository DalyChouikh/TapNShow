import { NextResponse } from "next/server";
import { getServerEnv } from "@/config/env";
import { tokensEqual } from "@/server/crypto/tokens";
import { scheduleDispatch } from "@/server/dispatch/schedule-dispatch";
import { apiError } from "@/server/http/errors";

/** `after()` work may run this long (the dispatcher's budget is 50 s). */
export const maxDuration = 60;

/**
 * Called every minute by Supabase Cron when jobs are due, and by nothing else (spec §8). Answers at
 * once so pg_net's 10 s timeout is never hit; the run continues after the response.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const secret = getServerEnv().DISPATCH_SECRET;
  if (!secret) {
    return apiError("not_found");
  }
  const provided =
    request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!tokensEqual(provided, secret)) {
    return apiError("unauthenticated");
  }
  scheduleDispatch();
  return NextResponse.json({ ok: true }, { status: 202 });
}
