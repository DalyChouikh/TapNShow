-- #255 (M6 minors), answers and reminders: a time moved back, a reminder holding back another
-- audience, the reconfirm reminder's wording, and answers from a page opened before a time change.

-- One rule: a reminder of this audience is still waiting for this person (pending, paused or being
-- sent). A waiting "not answered" reminder never holds back "going" (#255). Task 13 uses it too.
create function private.reminder_waiting(p_invitee uuid, p_audience text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.outbox_jobs o
    where o.invitee_id = p_invitee and o.kind = 'reminder' and o.status in ('pending', 'paused', 'processing')
      and coalesce(o.payload ->> 'audience', 'pending') = p_audience)
$$;
revoke execute on function private.reminder_waiting(uuid, text) from public, anon, authenticated;
grant execute on function private.reminder_waiting(uuid, text) to service_role;

-- enqueue_reminders: latest body from 20261009234223_m6_dispatch_kinds.sql; the "already waiting"
-- check is per audience (private.reminder_waiting).
create or replace function private.enqueue_reminders(p_meeting uuid, p_audience text, p_source text)
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
      and not private.reminder_waiting(i.id, p_audience)
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

-- token_invitee: latest body from 20261009235635_m6_edit_cancel.sql.
create or replace function public.token_invitee(p_token_hash text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'invitee_id', i.id,
    'workspace_name', w.name,
    'masked_email', private.mask_email(c.email),
    'full_name', c.full_name,
    'unsubscribed', c.unsubscribed_at is not null,
    'reported', c.unsubscribed_via is not distinct from 'report',
    'calendar_requested', i.calendar_requested_at is not null,
    'meeting', pg_catalog.jsonb_build_object(
      'title', m.title, 'starts_at', m.starts_at, 'timezone', m.timezone, 'duration_minutes', m.duration_minutes,
      'location_mode', m.location_mode, 'location_text', m.location_text, 'online_text', m.online_text,
      'meeting_url', m.meeting_url, 'agenda_md', m.agenda_md,
      'status', m.status,
      -- While this person is still to reconfirm: the time they answered for, i.e. before the first
      -- move after their answer (the answer page strikes it through).
      -- A time moved and moved back shows no "previous" time (#255); the flag itself stays.
      'previous_starts_at', case when r.needs_reconfirmation then nullif((
        select (mc.changes -> 'starts_at' ->> 0)::timestamptz
        from public.meeting_changes mc
        where mc.meeting_id = m.id and mc.kind = 'edit' and mc.changes ? 'starts_at'
          and mc.changed_at > r.updated_at
        order by mc.changed_at
        limit 1), m.starts_at) end
    ),
    'answers', pg_catalog.jsonb_build_object(
      'response_mode', m.response_mode, 'delay_options', m.delay_options, 'reason_required', m.reason_required,
      'comments_enabled', m.comments_enabled, 'footer_note', m.footer_note, 'response_deadline', m.response_deadline
    ),
    'answer', case when r.id is null then null else pg_catalog.jsonb_build_object(
      'status', r.status, 'delay_minutes', r.delay_minutes, 'reason', r.reason, 'comment', r.comment,
      'after_deadline', r.after_deadline, 'responded_at', r.responded_at, 'updated_at', r.updated_at,
      'needs_reconfirmation', r.needs_reconfirmation
    ) end
  )
  from public.meeting_invitees i
  join public.contacts c on c.id = i.contact_id
  join public.meetings m on m.id = i.meeting_id
  join public.workspaces w on w.id = i.workspace_id
  left join public.responses r on r.invitee_id = i.id
  where i.token_hash = p_token_hash;
$$;

-- dispatch_reserve: latest body from 20261010154539_m6_update_calendar_unsubscribed.sql; the
-- reservation says when a reminder goes to someone who must reconfirm.
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
    return pg_catalog.jsonb_build_object('kind', 'ok', 'reconfirm', coalesce(v_job.needs_reconfirmation, false) and v_job.kind = 'reminder', 'unsubscribed', true, 'calendar',
      pg_catalog.jsonb_build_object('action', v_action, 'sequence', v_job.calendar_sequence));
  end if;
  if v_action is not null then
    return pg_catalog.jsonb_build_object('kind', 'ok', 'reconfirm', coalesce(v_job.needs_reconfirmation, false) and v_job.kind = 'reminder', 'calendar',
      pg_catalog.jsonb_build_object('action', v_action, 'sequence', v_job.calendar_sequence));
  end if;
  -- A reminder to someone who must reconfirm says so instead of "Please answer by…" (#255).
  return pg_catalog.jsonb_build_object('kind', 'ok', 'reconfirm', coalesce(v_job.needs_reconfirmation, false) and v_job.kind = 'reminder');
end;
$$;

-- token_submit_response: latest body from 20261009235635_m6_edit_cancel.sql, with the start the
-- answer page showed (p_seen_starts_at). The signature changes, so drop + create + re-grant.
drop function public.token_submit_response(text, public.response_status, integer, text, text);
create function public.token_submit_response(
  p_token_hash text,
  p_status public.response_status,
  p_delay_minutes integer default null,
  p_reason text default null,
  p_comment text default null,
  p_seen_starts_at timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v record;
  v_delay smallint;
  v_reason text;
  v_comment text;
  v_after boolean;
  v_old public.responses;
  v_new public.responses;
  v_stale boolean;
begin
  select i.id as invitee_id, i.workspace_id, i.meeting_id, m.status, m.starts_at, m.response_mode,
    m.delay_options, m.reason_required, m.comments_enabled, m.response_deadline
  into v
  from public.meeting_invitees i
  join public.meetings m on m.id = i.meeting_id
  where i.token_hash = p_token_hash
  for update of i;
  if v.invitee_id is null then
    return null;
  end if;
  -- An answer from a page opened before the latest time change confirms the old time, so the
  -- person still has to reconfirm (#255).
  v_stale := p_seen_starts_at is not null and p_seen_starts_at is distinct from v.starts_at;
  if v.status <> 'scheduled' or v.starts_at is null or v.starts_at <= pg_catalog.now() then
    raise exception 'tn:answers_closed' using errcode = 'P0001';
  end if;
  if (v.response_mode = 'attendance' and p_status not in ('attending', 'late', 'absent'))
    or (v.response_mode = 'rsvp' and p_status not in ('attending', 'not_attending'))
    or v.response_mode = 'announcement' then
    raise exception 'tn:invalid_choice' using errcode = 'P0001';
  end if;
  if p_status = 'late' then
    if p_delay_minutes is null or not (p_delay_minutes::smallint = any (v.delay_options)) then
      raise exception 'tn:delay_required' using errcode = 'P0001';
    end if;
    v_delay := p_delay_minutes::smallint;
  end if;
  v_reason := case when p_status = 'attending' then '' else pg_catalog.btrim(coalesce(p_reason, '')) end;
  if p_status <> 'attending' and v.reason_required and v_reason = '' then
    raise exception 'tn:reason_required' using errcode = 'P0001';
  end if;
  v_comment := case when v.comments_enabled then pg_catalog.btrim(coalesce(p_comment, '')) else '' end;
  v_after := v.response_deadline is not null and pg_catalog.now() > v.response_deadline;

  select * into v_old from public.responses r where r.invitee_id = v.invitee_id;
  if v_old.id is not null
    and v_old.status = p_status
    and v_old.delay_minutes is not distinct from v_delay
    and v_old.reason = v_reason
    and v_old.comment = v_comment then
    if v_old.needs_reconfirmation and not v_stale then
      -- "Yes, still going" after a time change (spec §7.3): the same answer, confirmed again.
      update public.responses set needs_reconfirmation = false, updated_at = pg_catalog.now()
      where id = v_old.id
      returning * into v_new;
      insert into public.response_history (workspace_id, meeting_id, invitee_id, response_id, status, delay_minutes,
        reason, comment, after_deadline)
      -- The confirmation itself is late or not; the answer keeps its own after_deadline (#255).
      values (v.workspace_id, v.meeting_id, v.invitee_id, v_new.id, v_new.status, v_new.delay_minutes, v_new.reason,
        v_new.comment, v_after);
    else
      v_new := v_old;
    end if;
  else
    -- Any new answer also settles a pending reconfirmation.
    insert into public.responses (workspace_id, meeting_id, invitee_id, status, delay_minutes, reason, comment, after_deadline,
      needs_reconfirmation)
    values (v.workspace_id, v.meeting_id, v.invitee_id, p_status, v_delay, v_reason, v_comment, v_after, v_stale)
    on conflict (invitee_id) do update
      set status = excluded.status, delay_minutes = excluded.delay_minutes, reason = excluded.reason,
        comment = excluded.comment, after_deadline = excluded.after_deadline, needs_reconfirmation = v_stale,
        updated_at = pg_catalog.now()
    returning * into v_new;
    insert into public.response_history (workspace_id, meeting_id, invitee_id, response_id, status, delay_minutes,
      reason, comment, after_deadline)
    values (v.workspace_id, v.meeting_id, v.invitee_id, v_new.id, v_new.status, v_new.delay_minutes, v_new.reason,
      v_new.comment, v_new.after_deadline);
    perform private.refresh_calendar_job(v.invitee_id, v.workspace_id);
  end if;

  return pg_catalog.jsonb_build_object(
    'status', v_new.status, 'delay_minutes', v_new.delay_minutes, 'reason', v_new.reason,
    'comment', v_new.comment, 'after_deadline', v_new.after_deadline,
    'responded_at', v_new.responded_at, 'updated_at', v_new.updated_at,
    'needs_reconfirmation', v_new.needs_reconfirmation
  );
end;
$$;
revoke execute on function public.token_submit_response(text, public.response_status, integer, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.token_submit_response(text, public.response_status, integer, text, text, timestamptz)
  to service_role;
