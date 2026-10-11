import { NextResponse } from "next/server";
import { requireInternalSecret } from "@/server/http/internal-secret";
import { scheduleWorkers } from "@/server/workers/schedule-workers";

/** `after()` work may run this long (each worker keeps to its own budget inside it). */
export const maxDuration = 60;

/**
 * Called every minute by Supabase Cron when emails or a Google Sheet are due, and by nothing else
 * (spec §8). Answers at once so pg_net's 10 s timeout is never hit; both workers run after the
 * response, side by side.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const refused = requireInternalSecret(request);
  if (refused) {
    return refused;
  }
  scheduleWorkers();
  return NextResponse.json({ ok: true }, { status: 202 });
}
