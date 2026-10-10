-- Owner decision 2026-10-10: a time move (or any event change) also moves the calendar event of a
-- member who unsubscribed after adding it; they get the short calendar note and nothing else.
-- update_targets: latest body from 20261009235635_m6_edit_cancel.sql; dispatch_reserve: latest body
-- from 20261010150614_m6_cancel_unsubscribed_calendar.sql. Same signatures, so the grants stay.

create or replace function private.update_targets(p_meeting uuid, p_rule text, p_calendar boolean)
returns table (invitee_id uuid, workspace_id uuid, notify boolean)
language sql
stable
set search_path = ''
as $$
  -- Someone who unsubscribed is never notified; their calendar event still follows the meeting
  -- (owner decision 2026-10-10).
  select x.invitee_id, x.workspace_id, x.notify and not x.unsubscribed
  from (
    select i.id as invitee_id, i.workspace_id,
      i.calendar_state = 'added' or exists (
        select 1 from public.outbox_jobs j
        where j.invitee_id = i.id and j.kind = 'calendar_confirm' and j.status = 'processing'
      ) as calendar,
      case p_rule
        when 'all' then true
        when 'not_declined' then r.status is null or r.status not in ('absent', 'not_attending')
        else false
      end as notify,
      c.unsubscribed_at is not null as unsubscribed
    from public.meeting_invitees i
    join public.contacts c on c.id = i.contact_id
    left join public.responses r on r.invitee_id = i.id
    where i.meeting_id = p_meeting
      -- Invited, or being invited right now: the dispatcher renders a claimed invite from the
      -- details it read at claim time, so those people need the update too (review of Task 6).
      and (i.email_status in ('sent', 'unknown')
        or (i.email_status = 'queued' and exists (
          select 1 from public.outbox_jobs j
          where j.invitee_id = i.id and j.kind = 'invite' and j.status = 'processing')))
  ) x
  where (x.notify and not x.unsubscribed) or (p_calendar and x.calendar)
$$;

create or replace function public.dispatch_reserve(p_job uuid, p_token_hash text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job record;
  v_wanted boolean;
  v_action text;
  v_skip text;
  v_count integer;
  v_oldest timestamptz;
  v_retry timestamptz;
begin
  select j.id, j.kind, j.status, j.workspace_id, j.invitee_id, j.payload, c.google_sub, m.status as meeting_status,
    m.starts_at, m.response_mode, ct.unsubscribed_at, i.calendar_state, i.calendar_sequence,
    i.calendar_requested_at, i.email_status, r.status as answer, r.needs_reconfirmation
  into v_job
  from public.outbox_jobs j
  join public.workspaces w on w.id = j.workspace_id
  join public.google_connections c on c.id = w.sender_connection_id
  join public.meeting_invitees i on i.id = j.invitee_id
  join public.meetings m on m.id = i.meeting_id
  join public.contacts ct on ct.id = i.contact_id
  left join public.responses r on r.invitee_id = i.id
  where j.id = p_job
  for update of j, i;
  if v_job.id is null or v_job.status <> 'processing' then
    return pg_catalog.jsonb_build_object('kind', 'gone');
  end if;

  if v_job.kind = 'invite' then
    if v_job.unsubscribed_at is not null or v_job.meeting_status <> 'scheduled' or v_job.starts_at <= pg_catalog.now() then
      update public.outbox_jobs set status = case when v_job.starts_at <= pg_catalog.now() then 'failed'::public.job_status else 'done'::public.job_status end,
        locked_until = null,
        last_error = case
          when v_job.unsubscribed_at is not null then 'unsubscribed'
          when v_job.meeting_status <> 'scheduled' then 'meeting_cancelled'
          else 'meeting_started' end
      where id = p_job;
      update public.meeting_invitees set
        email_status = case when v_job.unsubscribed_at is null and v_job.meeting_status = 'scheduled' then 'failed'::public.invitee_email_status else 'skipped'::public.invitee_email_status end,
        email_error = case
          when v_job.unsubscribed_at is not null then 'unsubscribed'
          when v_job.meeting_status <> 'scheduled' then 'meeting_cancelled'
          else 'meeting_started' end
      where id = v_job.invitee_id;
      return pg_catalog.jsonb_build_object('kind', 'done');
    end if;
  else
    -- Should this person have the event in their calendar right now? (spec §8 calendar_confirm)
    v_wanted := v_job.meeting_status = 'scheduled'
      and (v_job.answer in ('attending', 'late')
           or (v_job.response_mode = 'announcement' and v_job.calendar_requested_at is not null));
    v_action := case v_job.kind
      when 'calendar_confirm' then case
        when v_wanted and v_job.calendar_state = 'none' then 'request'
        when not v_wanted and v_job.calendar_state = 'added' then 'cancel' end
      when 'update' then case when v_wanted and v_job.calendar_state = 'added' then 'request' end
      when 'cancel' then case when v_job.calendar_state = 'added' then 'cancel' end
    end;
    v_skip := case
      -- After unsubscribing, only their calendar event follows the meeting (moved or removed).
      -- Twin: calendarOnly in src/server/dispatch/run-dispatch.ts.
      when v_job.unsubscribed_at is not null and not (v_job.kind in ('update', 'cancel') and v_action is not null)
        then 'unsubscribed'
      when v_job.starts_at <= pg_catalog.now() then 'meeting_started'
      -- An update or cancellation for someone whose invite never went out (it failed, was skipped).
      when v_job.kind in ('update', 'cancel') and v_job.email_status not in ('sent', 'unknown') then 'not_invited'
      when v_job.kind = 'cancel' and v_job.meeting_status <> 'cancelled' then 'not_cancelled'
      when v_job.kind in ('update', 'reminder') and v_job.meeting_status <> 'scheduled' then 'meeting_cancelled'
      when v_job.kind = 'reminder'
        and not private.reminder_eligible(v_job.payload ->> 'audience', v_job.answer, v_job.needs_reconfirmation)
        then 'not_eligible'
      when v_job.kind = 'calendar_confirm' and v_action is null then 'nothing_to_send'
      -- Twin of updateHasSomethingToSay (src/server/dispatch/run-dispatch.ts): changes that cancelled
      -- out say nothing, even to a calendar holder; without a calendar part, only a notified person
      -- gets an email.
      when v_job.kind = 'update'
        and coalesce(v_job.payload -> 'changes', '{}'::jsonb) = '{}'::jsonb
        and (v_job.unsubscribed_at is not null or not coalesce((v_job.payload ->> 'reconfirm')::boolean, false))
        then 'nothing_to_send'
      when v_job.kind = 'update' and v_action is null
        and not coalesce((v_job.payload ->> 'notify')::boolean, false)
        then 'nothing_to_send'
    end;
    if v_skip is not null then
      update public.outbox_jobs set status = 'done', locked_until = null, last_error = v_skip where id = p_job;
      return pg_catalog.jsonb_build_object('kind', 'done');
    end if;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('send:' || v_job.google_sub));
  select count(*), min(s.sent_at) into v_count, v_oldest
  from public.send_log s where s.google_sub = v_job.google_sub and s.sent_at > pg_catalog.now() - interval '24 hours';
  if v_count >= private.app_limit('gmail_sends_per_day') then
    v_retry := v_oldest + interval '24 hours';
  else
    select count(*), min(s.sent_at) into v_count, v_oldest
    from public.send_log s where s.google_sub = v_job.google_sub and s.sent_at > pg_catalog.now() - interval '1 minute';
    if v_count >= private.app_limit('gmail_sends_per_minute') then
      v_retry := v_oldest + interval '1 minute';
    end if;
  end if;
  if v_retry is not null then
    update public.outbox_jobs
    set status = 'pending', attempts = greatest(attempts - 1, 0), run_after = v_retry, locked_until = null,
      run_id = null, last_error = 'quota'
    where id = p_job;
    return pg_catalog.jsonb_build_object('kind', 'quota', 'retry_at', v_retry);
  end if;

  insert into public.send_log (google_sub, workspace_id, job_id) values (v_job.google_sub, v_job.workspace_id, p_job)
  on conflict (job_id) where job_id is not null do nothing;
  update public.outbox_jobs
  set send_started_at = pg_catalog.now(),
    -- Drop a decision left by an earlier attempt, or dispatch_finish would record it (Task 3 review).
    payload = case when v_action is not null
      then payload || pg_catalog.jsonb_build_object('action', v_action, 'sequence', v_job.calendar_sequence)
      else payload - 'action' - 'sequence' end
  where id = p_job;
  -- The personal links must work in any email that may have gone out, including one whose outcome
  -- ends up "unknown" (the token is derived from the invitee id, so storing it early is safe).
  if p_token_hash is not null then
    update public.meeting_invitees set token_hash = coalesce(token_hash, p_token_hash) where id = v_job.invitee_id;
  end if;
  if v_job.unsubscribed_at is not null then
    -- Only a calendar update or removal gets here (see v_skip): the email is the short calendar
    -- note, without the unsubscribe link.
    return pg_catalog.jsonb_build_object('kind', 'ok', 'unsubscribed', true, 'calendar',
      pg_catalog.jsonb_build_object('action', v_action, 'sequence', v_job.calendar_sequence));
  end if;
  if v_action is not null then
    return pg_catalog.jsonb_build_object('kind', 'ok', 'calendar',
      pg_catalog.jsonb_build_object('action', v_action, 'sequence', v_job.calendar_sequence));
  end if;
  return pg_catalog.jsonb_build_object('kind', 'ok');
end;
$$;
