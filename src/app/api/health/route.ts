import { NextResponse } from "next/server";
import { APP_NAME } from "@/config/app";
import { logger } from "@/lib/logger";
import { getDatabaseTime } from "@/server/queries/health";
import { createSupabaseAdminClient } from "@/server/supabase/admin-client";

/** Liveness + database connectivity probe. Never exposes error details. */
export async function GET(): Promise<NextResponse> {
  try {
    const admin = createSupabaseAdminClient();
    const databaseTime = await getDatabaseTime({
      rpc: (fn) => admin.rpc(fn),
    });
    return NextResponse.json({ status: "ok", app: APP_NAME, databaseTime });
  } catch (error) {
    logger.error({ err: error }, "health check failed");
    return NextResponse.json(
      { status: "degraded", app: APP_NAME },
      { status: 503 },
    );
  }
}
