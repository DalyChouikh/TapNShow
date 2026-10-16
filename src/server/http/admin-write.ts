import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NextResponse } from "next/server";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";
import type { AdminResult } from "@/server/queries/admin";
import { scheduleWorkers } from "@/server/workers/schedule-workers";
import { adminOk, loadAdminContext } from "./admin-context";
import { apiError } from "./errors";
import { rejectCrossOrigin } from "./request";

/**
 * One admin write on one row (spec §10 Admin API): the Origin check, a well-formed id, a platform
 * admin (the platform owner when `ownerOnly`; anyone else sees not found, like the database), the
 * action, then the platform lane, so the event it logged reaches `#platform` now.
 */
export async function runAdminWrite(
  request: Request,
  rawId: string,
  options: {
    ownerOnly?: boolean;
    action: (
      supabase: SupabaseClient<Database>,
      id: string,
    ) => Promise<AdminResult<true>>;
  },
): Promise<NextResponse> {
  const blocked = rejectCrossOrigin(request);
  if (blocked) {
    return blocked;
  }
  const id = z.uuid().safeParse(rawId);
  if (!id.success) {
    return apiError("invalid_input");
  }
  const context = await loadAdminContext();
  if (!context.ok) {
    return context.response;
  }
  if (options.ownerOnly && context.role !== "owner") {
    return apiError("not_found");
  }
  const result = await options.action(context.supabase, id.data);
  if (!result.error) {
    scheduleWorkers(["platform"]);
  }
  return adminOk(result);
}
