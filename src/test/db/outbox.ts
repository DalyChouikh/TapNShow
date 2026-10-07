import { z } from "zod";
import { adminClient } from "./clients";
import { queryLocalSql, runLocalSql } from "./sql";

/** Calls a dispatcher RPC as the service role and returns its JSON (throws on error). */
export async function serviceRpc(
  name: string,
  args: Record<string, string | number | string[] | null>,
) {
  const { data, error } = await adminClient().rpc(name as never, args as never);
  if (error) {
    throw error;
  }
  return data as object | null;
}

/** Sets a numeric limit for one test and returns a function restoring the original value. */
export function overrideLimit(name: string, value: number): () => void {
  const [row] = queryLocalSql(
    `select value from private.app_limits where name = '${name}'`,
    z.array(z.object({ value: z.number() })).length(1),
  );
  runLocalSql(
    `update private.app_limits set value = ${value} where name = '${name}'`,
  );
  return () =>
    runLocalSql(
      `update private.app_limits set value = ${row.value} where name = '${name}'`,
    );
}

/** Job rows of one meeting (service role). */
export async function jobsOf(meetingId: string) {
  const { data, error } = await adminClient()
    .from("outbox_jobs")
    .select(
      "id, status, attempts, run_after, last_error, idempotency_key, send_started_at, invitee_id, meeting_invitees!inner(meeting_id)",
    )
    .eq("meeting_invitees.meeting_id", meetingId);
  if (error) {
    throw error;
  }
  return data;
}
