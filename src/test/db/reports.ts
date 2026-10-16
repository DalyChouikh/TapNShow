import { runLocalSql } from "./sql";

/**
 * Simulates `count` people the workspace emailed in the last week: one finished invite job and its
 * send_log row each (the rule counts distinct people in send_log, spec §7.12).
 */
export function seedEmailedPeople(
  workspaceId: string,
  meetingId: string,
  count: number,
): void {
  runLocalSql(`
    with people as (
      insert into public.contacts (workspace_id, email, full_name)
      select '${workspaceId}', 'p' || g || '-' || gen_random_uuid() || '@example.test', 'P ' || g
      from generate_series(1, ${count}) g
      returning id
    ), invitees as (
      insert into public.meeting_invitees (workspace_id, meeting_id, contact_id, email_status, sent_at)
      select '${workspaceId}', '${meetingId}', p.id, 'sent', now() from people p
      returning id
    ), jobs as (
      insert into public.outbox_jobs (kind, workspace_id, invitee_id, payload, idempotency_key, status)
      select 'invite', '${workspaceId}', i.id, '{}'::jsonb, 'invite:' || i.id, 'done' from invitees i
      returning id
    )
    insert into public.send_log (google_sub, workspace_id, job_id, sent_at)
    select 'sub-test', '${workspaceId}', j.id, now() from jobs j;
  `);
}

/** One "Not my group" report against the workspace, `ago` before now (as token_unsubscribe writes it). */
export function seedReport(workspaceId: string, ago = "0 minutes"): void {
  runLocalSql(
    `insert into public.abuse_reports (workspace_id, reported_at) values ('${workspaceId}', now() - interval '${ago}')`,
  );
}
