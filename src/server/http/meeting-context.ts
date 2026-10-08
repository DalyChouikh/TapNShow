import "server-only";
import type { NextResponse } from "next/server";
import { getMeeting } from "@/server/queries/meetings";
import type { Meeting } from "@/shared/api/meetings";
import { apiError, fromDatabaseError } from "./errors";
import {
  loadWorkspaceContext,
  type WorkspaceContext,
} from "./workspace-context";

/** A workspace context plus one of its meetings. */
export type MeetingContext =
  | (Extract<WorkspaceContext, { ok: true }> & { meeting: Meeting })
  | { ok: false; response: NextResponse };

/** Session + membership + a meeting that belongs to this slug's workspace (else 404). */
export async function loadMeetingContext(
  slug: string,
  meetingId: string,
): Promise<MeetingContext> {
  const context = await loadWorkspaceContext(slug);
  if (!context.ok) {
    return context;
  }
  const { data, error } = await getMeeting(
    context.supabase,
    context.workspace.id,
    meetingId,
  );
  if (error) {
    return { ok: false, response: fromDatabaseError(error) };
  }
  return data
    ? { ...context, meeting: data }
    : { ok: false, response: apiError("not_found") };
}
