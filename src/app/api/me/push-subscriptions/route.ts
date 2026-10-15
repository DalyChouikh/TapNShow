import type { NextResponse } from "next/server";
import { z } from "zod";
import { getServerEnv } from "@/config/env";
import { publicEnv } from "@/config/public-env";
import { apiError, fromDatabaseError, ok } from "@/server/http/errors";
import { parseJsonBody, rejectCrossOrigin } from "@/server/http/request";
import { requireUser } from "@/server/http/require-user";
import { pushConfigured } from "@/server/push/push-deps";
import { subscribePush, unsubscribePush } from "@/server/queries/push";
import { createSupabaseServerClient } from "@/server/supabase/server-client";
import {
  pushSubscriptionBodySchema,
  pushUnsubscribeBodySchema,
} from "@/shared/api/push";

/** A same-origin, signed-in request with a valid body, or the response refusing it. */
async function readRequest<T>(request: Request, schema: z.ZodType<T>) {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return { ok: false as const, response: blocked };
  }
  const supabase = await createSupabaseServerClient();
  if (!(await requireUser(supabase))) {
    return { ok: false as const, response: apiError("unauthenticated") };
  }
  const body = await parseJsonBody(request, schema);
  return body.ok
    ? { ok: true as const, supabase, body: body.data }
    : { ok: false as const, response: body.response };
}

/** Turn on reminders for this browser (spec §7.4; rate limited, at most 10 devices). */
export async function POST(request: Request): Promise<NextResponse> {
  if (!pushConfigured(getServerEnv(), publicEnv)) {
    return rejectCrossOrigin(request) ?? apiError("reminders_unavailable");
  }
  const read = await readRequest(request, pushSubscriptionBodySchema);
  if (!read.ok) {
    return read.response;
  }
  const { error } = await subscribePush(read.supabase, read.body);
  return error ? fromDatabaseError(error) : ok();
}

/**
 * Turn off reminders for this browser (the Account switch, sign-out, account deletion; rate
 * limited, the device unsubscribes itself either way). Works even when reminders aren't
 * configured, so a device can always be forgotten.
 */
export async function DELETE(request: Request): Promise<NextResponse> {
  const read = await readRequest(request, pushUnsubscribeBodySchema);
  if (!read.ok) {
    return read.response;
  }
  const { error } = await unsubscribePush(read.supabase, read.body.endpoint);
  return error ? fromDatabaseError(error) : ok();
}
