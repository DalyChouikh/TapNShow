-- Keeps a sent meeting's two reminder timers (spec §7.6) in line with its time, deadline and
-- settings: one pending timer per audience whose due time is still ahead, none otherwise.
create function private.sync_reminder_timers(p_meeting uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v public.meetings;
  v_audience text;
  v_due timestamptz;
begin
  select * into v from public.meetings m where m.id = p_meeting;
  foreach v_audience in array array['pending', 'going'] loop
    v_due := case
      when v.status <> 'scheduled' or v.response_mode = 'announcement' or v.starts_at is null then null
      when v_audience = 'pending' then
        coalesce(v.response_deadline, v.starts_at) - pg_catalog.make_interval(hours => v.reminder_pending_hours)
      else v.starts_at - pg_catalog.make_interval(hours => v.reminder_going_hours)
    end;
    if v_due is null or v_due <= pg_catalog.now() then
      delete from public.outbox_jobs j
      where j.meeting_id = p_meeting and j.kind = 'reminder' and j.invitee_id is null
        and j.status in ('pending', 'paused') and j.payload ->> 'audience' = v_audience;
    else
      update public.outbox_jobs j set run_after = v_due, status = 'pending', last_error = null
      where j.meeting_id = p_meeting and j.kind = 'reminder' and j.invitee_id is null
        and j.status in ('pending', 'paused') and j.payload ->> 'audience' = v_audience;
      if not found then
        insert into public.outbox_jobs (kind, workspace_id, meeting_id, payload, idempotency_key, run_after)
        values ('reminder', v.workspace_id, p_meeting, pg_catalog.jsonb_build_object('audience', v_audience),
          'reminder:' || p_meeting::text || ':' || v_audience || ':' || gen_random_uuid()::text, v_due);
      end if;
    end if;
  end loop;
end;
$$;

revoke execute on function private.sync_reminder_timers(uuid) from public, anon, authenticated;

-- send_meeting: latest body from 20261009214226_m6_foundation.sql; the first send creates the
-- reminder timers.
create or replace function private.send_meeting(p_meeting uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meeting public.meetings;
  v_problem text;
  v_invited integer;
  v_new integer;
  v_skipped integer;
begin
  select * into v_meeting from public.meetings m where m.id = p_meeting for update;
  if v_meeting.id is null or not private.is_member(v_meeting.workspace_id) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if not private.is_member(v_meeting.workspace_id, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if v_meeting.status = 'cancelled' then
    raise exception 'tn:meeting_not_draft' using errcode = 'P0001';
  end if;
  if private.meeting_incomplete(v_meeting) then
    raise exception 'tn:meeting_incomplete' using errcode = 'P0001';
  end if;
  if v_meeting.status = 'draft' then
    v_problem := private.response_deadline_problem(v_meeting.response_deadline, v_meeting.starts_at);
    if v_problem is not null then
      raise exception 'tn:%', v_problem using errcode = 'P0001';
    end if;
  end if;
  if v_meeting.starts_at <= pg_catalog.now() then
    raise exception 'tn:meeting_in_past' using errcode = 'P0001';
  end if;
  perform private.require_active_sender(v_meeting.workspace_id);

  select
    count(*) filter (where am.invited),
    count(*) filter (where am.mode is distinct from 'exclude' and not am.invited and not am.unsubscribed),
    count(*) filter (where am.mode is distinct from 'exclude' and not am.invited and am.unsubscribed)
  into v_invited, v_new, v_skipped
  from private.audience_members(p_meeting) am;
  if v_new = 0 then
    raise exception 'tn:nothing_to_send' using errcode = 'P0001';
  end if;
  if v_invited + v_new > private.app_limit('invitees_per_meeting_max') then
    raise exception 'tn:too_many_invitees' using errcode = 'P0001';
  end if;

  with inserted as (
    insert into public.meeting_invitees (workspace_id, meeting_id, contact_id)
    select v_meeting.workspace_id, p_meeting, am.contact_id
    from private.audience_members(p_meeting) am
    where am.mode is distinct from 'exclude' and not am.invited and not am.unsubscribed
    on conflict (meeting_id, contact_id) do nothing
    returning id
  )
  insert into public.outbox_jobs (kind, workspace_id, invitee_id, idempotency_key)
  select 'invite', v_meeting.workspace_id, i.id, 'invite:' || i.id::text from inserted i
  on conflict (idempotency_key) do nothing;

  update public.meetings set status = 'scheduled', sent_at = coalesce(sent_at, pg_catalog.now()) where id = p_meeting;
  -- The first send creates the reminder timers (spec §7.6); Invite more leaves them as they are.
  if v_meeting.status = 'draft' then
    perform private.sync_reminder_timers(p_meeting);
  end if;
  return pg_catalog.jsonb_build_object('invited', v_new, 'skipped_unsubscribed', v_skipped);
end;
$$;

-- M6 job kinds in the dispatcher (spec §7.6, §8): reminder timers fan out into per-person jobs
-- before anything is claimed; update / cancel / reminder decide at reserve time like
-- calendar_confirm, and any calendar decision is recorded the same way.

-- Who a reminder is for (spec §7.6); used at fan-out, at reserve time and for the Nudge count.
create function private.reminder_eligible(p_audience text, p_answer public.response_status, p_reconfirm boolean)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_audience
    when 'pending' then p_answer is null or coalesce(p_reconfirm, false)
    when 'going' then p_answer in ('attending', 'late') and not coalesce(p_reconfirm, false)
    else false
  end
$$;

-- Queues one reminder per eligible invitee; `p_source` (a timer id or a nudge id) makes a repeat
-- of the same fan-out a no-op. Returns how many were queued.
create function private.enqueue_reminders(p_meeting uuid, p_audience text, p_source text)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  with eligible as (
    select i.id, i.workspace_id
    from public.meeting_invitees i
    join public.meetings m on m.id = i.meeting_id
    join public.contacts c on c.id = i.contact_id
    left join public.responses r on r.invitee_id = i.id
    where i.meeting_id = p_meeting and m.status = 'scheduled' and m.starts_at > pg_catalog.now()
      and m.response_mode <> 'announcement' and i.email_status in ('sent', 'unknown')
      and c.unsubscribed_at is null
      and private.reminder_eligible(p_audience, r.status, r.needs_reconfirmation)
      -- One reminder at a time: a nudge or a timer never doubles one still waiting (paused, quota).
      and not exists (
        select 1 from public.outbox_jobs o
        where o.invitee_id = i.id and o.kind = 'reminder' and o.status in ('pending', 'paused', 'processing')
      )
  ), inserted as (
    insert into public.outbox_jobs (kind, workspace_id, invitee_id, meeting_id, payload, idempotency_key)
    select 'reminder', e.workspace_id, e.id, p_meeting, pg_catalog.jsonb_build_object('audience', p_audience),
      'reminder:' || e.id::text || ':' || p_source
    from eligible e
    on conflict (idempotency_key) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;
  return v_count;
end;
$$;

-- Due timers become per-person jobs; the timer itself is done. Runs at the top of dispatch_claim.
create function private.fan_out_reminders()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_timer record;
  v_total integer := 0;
begin
  for v_timer in
    update public.outbox_jobs j
    set status = 'done', last_error = null
    where j.id in (
      select t.id from public.outbox_jobs t
      where t.kind = 'reminder' and t.invitee_id is null and t.status = 'pending'
        and t.run_after <= pg_catalog.now()
      for update skip locked
    )
    returning j.id, j.meeting_id, j.payload ->> 'audience' as audience
  loop
    v_total := v_total + private.enqueue_reminders(v_timer.meeting_id, v_timer.audience, 'timer-' || v_timer.id::text);
  end loop;
  return v_total;
end;
$$;

revoke execute on function private.reminder_eligible(text, public.response_status, boolean),
  private.enqueue_reminders(uuid, text, text), private.fan_out_reminders()
  from public, anon, authenticated;
grant execute on function private.reminder_eligible(text, public.response_status, boolean),
  private.enqueue_reminders(uuid, text, text), private.fan_out_reminders()
  to service_role;

-- dispatch_claim: latest body from 20261008182630_m5_calendar_dispatch.sql; fans out timers first,
-- never pauses or claims a timer, returns each job's payload, and records a lost lease's calendar
-- decision for every kind but the invite.
create or replace function public.dispatch_claim(p_run uuid, p_limit integer, p_lease_seconds integer)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_connection public.google_connections;
  v_lease interval := pg_catalog.make_interval(secs => p_lease_seconds);
  v_rows integer;
  v_lost record;
begin
  -- Due reminder timers become per-person jobs before anything is claimed (spec §7.6).
  perform private.fan_out_reminders();

  -- A lease expired after the email may have reached Gmail: never resend (at most once). An invite
  -- becomes "Delivery unknown"; any email carrying a calendar decision (in payload) is recorded as
  -- sent.
  for v_lost in
    update public.outbox_jobs j
    set status = 'failed', last_error = 'delivery_unknown', locked_until = null
    where j.status = 'processing' and j.locked_until < pg_catalog.now() and j.send_started_at is not null
    returning j.invitee_id, j.kind, j.payload
  loop
    if v_lost.kind = 'invite' then
      update public.meeting_invitees i set email_status = 'unknown', email_error = 'delivery_unknown'
      where i.id = v_lost.invitee_id;
    elsif v_lost.kind <> 'invite' and v_lost.payload ? 'action' then
      update public.meeting_invitees i
      set calendar_state = case when v_lost.payload ->> 'action' = 'request'
                                then 'added'::public.calendar_state else 'none'::public.calendar_state end,
        calendar_sequence = (v_lost.payload ->> 'sequence')::integer + 1
      where i.id = v_lost.invitee_id;
    end if;
  end loop;

  update public.outbox_jobs j
  set status = 'pending', locked_until = null, run_id = null
  where j.status = 'processing' and j.locked_until < pg_catalog.now() and j.send_started_at is null;

  update public.outbox_jobs j
  set status = 'paused', last_error = 'no_sender'
  from public.workspaces w
  left join public.google_connections c on c.id = w.sender_connection_id
  where j.workspace_id = w.id and j.status = 'pending' and j.run_after <= pg_catalog.now()
    and j.invitee_id is not null and (c.id is null or c.status <> 'active');

  select c.* into v_connection
  from public.outbox_jobs j
  join public.workspaces w on w.id = j.workspace_id
  join public.google_connections c on c.id = w.sender_connection_id and c.status = 'active'
  left join public.sender_leases l on l.google_sub = c.google_sub
  where j.status = 'pending' and j.run_after <= pg_catalog.now() and j.invitee_id is not null
    and (l.google_sub is null or l.locked_until < pg_catalog.now() or l.run_id = p_run)
  order by j.run_after, j.created_at
  limit 1;
  if v_connection.id is null then
    return null;
  end if;

  insert into public.sender_leases (google_sub, run_id, locked_until)
  values (v_connection.google_sub, p_run, pg_catalog.now() + v_lease)
  on conflict (google_sub) do update
    set run_id = excluded.run_id, locked_until = excluded.locked_until
    where public.sender_leases.locked_until < pg_catalog.now() or public.sender_leases.run_id = excluded.run_id;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    return null;
  end if;

  with picked as (
    select j.id
    from public.outbox_jobs j
    join public.workspaces w on w.id = j.workspace_id
    where w.sender_connection_id = v_connection.id and j.status = 'pending' and j.run_after <= pg_catalog.now()
      and j.invitee_id is not null
    order by j.run_after, j.created_at
    limit p_limit
    for update of j skip locked
  )
  update public.outbox_jobs j
  set status = 'processing', attempts = j.attempts + 1, run_id = p_run, locked_until = pg_catalog.now() + v_lease
  from picked where j.id = picked.id;

  return pg_catalog.jsonb_build_object(
    'connection', pg_catalog.jsonb_build_object(
      'id', v_connection.id,
      'user_id', v_connection.user_id,
      'google_sub', v_connection.google_sub,
      'google_email', v_connection.google_email,
      'refresh_token_encrypted', v_connection.refresh_token_encrypted
    ),
    'jobs', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'job_id', j.id,
          'kind', j.kind,
          'attempts', j.attempts,
          'payload', j.payload,
          'invitee_id', i.id,
          'workspace_id', w.id,
          'workspace_name', w.name,
          'contact', pg_catalog.jsonb_build_object('full_name', c.full_name, 'email', c.email),
          'meeting', pg_catalog.jsonb_build_object(
            'id', m.id, 'title', m.title, 'agenda_md', m.agenda_md, 'starts_at', m.starts_at,
            'duration_minutes', m.duration_minutes, 'timezone', m.timezone, 'location_mode', m.location_mode,
            'location_text', m.location_text, 'online_text', m.online_text, 'meeting_url', m.meeting_url,
            'response_mode', m.response_mode, 'response_deadline', m.response_deadline, 'footer_note', m.footer_note,
            'ics_uid', m.ics_uid,
            'thread_id', case when m.thread_connection_id = v_connection.id then m.gmail_thread_id end,
            'root_message_id', case when m.thread_connection_id = v_connection.id then m.gmail_root_message_id end
          )
        )
        order by m.id, j.created_at
      )
      from public.outbox_jobs j
      join public.meeting_invitees i on i.id = j.invitee_id
      join public.meetings m on m.id = i.meeting_id
      join public.contacts c on c.id = i.contact_id
      join public.workspaces w on w.id = j.workspace_id
      where j.run_id = p_run and j.status = 'processing' and w.sender_connection_id = v_connection.id
    ), '[]'::jsonb)
  );
end;
$$;

-- dispatch_reserve decides per kind at send time (spec §8).
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
    i.calendar_requested_at, r.status as answer, r.needs_reconfirmation
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
      when v_job.unsubscribed_at is not null then 'unsubscribed'
      when v_job.starts_at <= pg_catalog.now() then 'meeting_started'
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
        and not coalesce((v_job.payload ->> 'reconfirm')::boolean, false)
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
  if v_action is not null then
    return pg_catalog.jsonb_build_object('kind', 'ok', 'calendar',
      pg_catalog.jsonb_build_object('action', v_action, 'sequence', v_job.calendar_sequence));
  end if;
  return pg_catalog.jsonb_build_object('kind', 'ok');
end;
$$;

-- dispatch_finish: latest body from 20261008182630_m5_calendar_dispatch.sql; calendar decisions for every
-- kind but the invite, and a skip gives its quota slot back.
create or replace function public.dispatch_finish(
  p_job uuid,
  p_outcome public.invitee_email_status,
  p_error text,
  p_token_hash text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_invitee uuid;
  v_kind public.job_kind;
  v_payload jsonb;
begin
  update public.outbox_jobs
  set status = case when p_outcome in ('sent', 'skipped') then 'done'::public.job_status else 'failed'::public.job_status end,
    last_error = p_error, locked_until = null
  where id = p_job and status = 'processing'
  returning invitee_id, kind, payload into v_invitee, v_kind, v_payload;
  if v_invitee is null then
    return;
  end if;
  -- Nothing went out: give the quota slot back (a skip after reserve sent nothing either).
  if p_outcome in ('failed', 'skipped') then
    delete from public.send_log s where s.job_id = p_job;
  end if;
  -- Every kind but the invite: record a calendar decision, never touch the invite's status.
  if v_kind <> 'invite' then
    if p_outcome in ('sent', 'unknown') and v_payload ? 'action' then
      update public.meeting_invitees
      set calendar_state = case when v_payload ->> 'action' = 'request'
                                then 'added'::public.calendar_state else 'none'::public.calendar_state end,
        calendar_sequence = (v_payload ->> 'sequence')::integer + 1
      where id = v_invitee;
    end if;
    return;
  end if;
  update public.meeting_invitees
  set email_status = p_outcome,
    email_error = p_error,
    sent_at = case when p_outcome = 'sent' then pg_catalog.now() end,
    token_hash = case when p_outcome = 'sent' then coalesce(token_hash, p_token_hash) else token_hash end
  where id = v_invitee;
end;
$$;

-- Nudge (spec §7.6): remind people who haven't answered, at most every nudge_interval_hours.
create function private.nudge_meeting(p_meeting uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meeting public.meetings;
  v_next timestamptz;
  v_count integer;
begin
  select * into v_meeting from public.meetings m where m.id = p_meeting for update;
  if v_meeting.id is null or not private.is_member(v_meeting.workspace_id) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if not private.is_member(v_meeting.workspace_id, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if v_meeting.status = 'cancelled' then
    raise exception 'tn:meeting_cancelled' using errcode = 'P0001';
  end if;
  if v_meeting.status <> 'scheduled' or v_meeting.response_mode = 'announcement' then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if v_meeting.starts_at <= pg_catalog.now() then
    raise exception 'tn:meeting_started' using errcode = 'P0001';
  end if;
  v_next := v_meeting.last_nudged_at
    + pg_catalog.make_interval(hours => private.app_limit('nudge_interval_hours'));
  if v_next > pg_catalog.now() then
    raise exception 'tn:nudge_too_soon' using errcode = 'P0001';
  end if;
  perform private.require_active_sender(v_meeting.workspace_id);
  v_count := private.enqueue_reminders(p_meeting, 'pending', 'nudge-' || gen_random_uuid()::text);
  if v_count = 0 then
    raise exception 'tn:nothing_to_send' using errcode = 'P0001';
  end if;
  update public.meetings set last_nudged_at = pg_catalog.now(), last_nudged_count = v_count where id = p_meeting;
  return pg_catalog.jsonb_build_object(
    'reminded', v_count,
    'next_at', pg_catalog.now() + pg_catalog.make_interval(hours => private.app_limit('nudge_interval_hours'))
  );
end;
$$;
revoke execute on function private.nudge_meeting(uuid) from public, anon;
grant execute on function private.nudge_meeting(uuid) to authenticated;

create function public.nudge_meeting(p_meeting uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.nudge_meeting(p_meeting) $$;
revoke execute on function public.nudge_meeting(uuid) from public, anon;
grant execute on function public.nudge_meeting(uuid) to authenticated;

-- Reminder timers are not emails: holding a sender back, marking it broken or reconnecting it must
-- leave them at their due time (review of Task 5: otherwise every upcoming reminder would fire at
-- once). Latest bodies from 20261007205641_m4_outbox.sql; only `j.invitee_id is not null` is new.
create or replace function public.dispatch_defer_sender(p_run uuid, p_connection uuid, p_until timestamptz, p_error text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.send_log s using public.outbox_jobs j
  where s.job_id = j.id and j.run_id = p_run and j.status = 'processing';
  update public.outbox_jobs j
  set status = 'pending', run_after = p_until, last_error = p_error, locked_until = null, run_id = null,
    send_started_at = null,
    attempts = case when j.status = 'processing' then greatest(j.attempts - 1, 0) else j.attempts end
  where (j.status = 'processing' and j.run_id = p_run)
    or (j.status = 'pending' and j.invitee_id is not null and j.workspace_id in (
      select w.id from public.workspaces w where w.sender_connection_id = p_connection
    ));
end;
$$;

create or replace function private.dispatch_mark_broken(p_run uuid, p_connection uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
  v_alert boolean := false;
begin
  update public.google_connections
  set status = 'broken', broken_reason = left(p_reason, 200), broken_at = pg_catalog.now()
  where id = p_connection and status = 'active';
  get diagnostics v_rows = row_count;

  delete from public.send_log s using public.outbox_jobs j
  where s.job_id = j.id and j.run_id = p_run and j.status = 'processing';
  update public.outbox_jobs j
  set status = 'paused', last_error = 'sender_broken', locked_until = null, run_id = null, send_started_at = null,
    attempts = case when j.status = 'processing' then greatest(j.attempts - 1, 0) else j.attempts end
  where (j.status = 'processing' and j.run_id = p_run)
    or (j.status = 'pending' and j.invitee_id is not null and j.workspace_id in (
      select w.id from public.workspaces w where w.sender_connection_id = p_connection
    ));

  if v_rows > 0 then
    v_alert := private.hit_rate_limit(
      'invite_email:platform', private.app_limit('invite_email_platform_per_day'), interval '24 hours'
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'newly_broken', v_rows > 0,
    'alert', case when v_alert then coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('email', u.email, 'workspace_name', w.name, 'workspace_slug', w.slug))
      from public.workspaces w
      join public.workspace_roles r on r.workspace_id = w.id and r.role = 'owner'
      join auth.users u on u.id = r.user_id
      where w.sender_connection_id = p_connection
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

create or replace function private.resume_paused_jobs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'workspaces' then
    if new.sender_connection_id is not null then
      update public.outbox_jobs j set status = 'pending', run_after = pg_catalog.now(), last_error = null
      where j.workspace_id = new.id and j.status = 'paused' and j.invitee_id is not null;
    end if;
  elsif new.status = 'active' and old.status = 'broken' then
    update public.outbox_jobs j set status = 'pending', run_after = pg_catalog.now(), last_error = null
    where j.status = 'paused' and j.invitee_id is not null
      and j.workspace_id in (select w.id from public.workspaces w where w.sender_connection_id = new.id);
  end if;
  return null;
end;
$$;

-- The every-minute fan-out probe reads only due timers.
create index outbox_jobs_due_timers_idx on public.outbox_jobs (run_after)
  where kind = 'reminder' and invitee_id is null and status = 'pending';

