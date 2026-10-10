import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/server/db/database.types";
import { sqlNullable } from "@/server/db/rpc-args";
import type { Mark } from "@/shared/api/responses";
import type { DbError } from "./roster";

type Client = SupabaseClient<Database>;
type Result<T> = { data: T | null; error: DbError | null };

const dbMarkSchema = z
  .object({
    actual: z.enum(["present", "late", "absent"]),
    marked_at: z.string(),
    marked_by_name: z.string().nullable(),
  })
  .nullable();

/** `mark_attendance()`: one person's check-in (null clears it); the saved mark (spec §7.8). */
export async function markAttendance(
  client: Client,
  meetingId: string,
  inviteeId: string,
  actual: Mark["actual"] | null,
): Promise<Result<Mark | null>> {
  const { data, error } = await client.rpc("mark_attendance", {
    p_meeting: meetingId,
    p_invitee: inviteeId,
    p_actual: sqlNullable(actual),
  });
  if (error) {
    return { data: null, error };
  }
  const db = dbMarkSchema.parse(data);
  return {
    data: db
      ? {
          actual: db.actual,
          markedAt: db.marked_at,
          markedByName: db.marked_by_name,
        }
      : null,
    error: null,
  };
}

/** `mark_rest_as_declared()`: how many people it marked. */
export async function markRestAsDeclared(
  client: Client,
  meetingId: string,
): Promise<Result<number>> {
  const { data, error } = await client.rpc("mark_rest_as_declared", {
    p_meeting: meetingId,
  });
  return error
    ? { data: null, error }
    : { data: z.number().int().parse(data), error: null };
}
