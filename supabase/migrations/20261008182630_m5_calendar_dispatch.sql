-- M5 calendar confirmation jobs in the dispatcher (spec §8 calendar_confirm): a final-state job
-- decides at reserve time whether to add the event, remove it, or do nothing; calendar jobs never
-- change an invite's email status.

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
  -- A lease expired after the email may have reached Gmail: never resend (at most once). An invite
  -- becomes "Delivery unknown"; a calendar email is recorded as sent (its decision is in payload).
  for v_lost in
    update public.outbox_jobs j
    set status = 'failed', last_error = 'delivery_unknown', locked_until = null
    where j.status = 'processing' and j.locked_until < pg_catalog.now() and j.send_started_at is not null
    returning j.invitee_id, j.kind, j.payload
  loop
    if v_lost.kind = 'invite' then
      update public.meeting_invitees i set email_status = 'unknown', email_error = 'delivery_unknown'
      where i.id = v_lost.invitee_id;
    elsif v_lost.kind = 'calendar_confirm' and v_lost.payload ? 'action' then
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
    and (c.id is null or c.status <> 'active');

  select c.* into v_connection
  from public.outbox_jobs j
  join public.workspaces w on w.id = j.workspace_id
  join public.google_connections c on c.id = w.sender_connection_id and c.status = 'active'
  left join public.sender_leases l on l.google_sub = c.google_sub
  where j.status = 'pending' and j.run_after <= pg_catalog.now()
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

create or replace function public.dispatch_reserve(p_job uuid, p_token_hash text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job record;
  v_action text;
  v_count integer;
  v_oldest timestamptz;
  v_retry timestamptz;
begin
  select j.id, j.kind, j.status, j.workspace_id, j.invitee_id, c.google_sub, m.status as meeting_status,
    m.starts_at, m.response_mode, ct.unsubscribed_at, i.calendar_state, i.calendar_sequence,
    i.calendar_requested_at, r.status as answer
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

  if v_job.kind = 'calendar_confirm' then
    if v_job.unsubscribed_at is not null or v_job.starts_at <= pg_catalog.now() then
      update public.outbox_jobs set status = 'done', locked_until = null,
        last_error = case when v_job.unsubscribed_at is not null then 'unsubscribed' else 'meeting_started' end
      where id = p_job;
      return pg_catalog.jsonb_build_object('kind', 'done');
    end if;
    v_action := case
      when v_job.meeting_status = 'scheduled'
        and (v_job.answer in ('attending', 'late')
             or (v_job.response_mode = 'announcement' and v_job.calendar_requested_at is not null))
      then case when v_job.calendar_state = 'none' then 'request' end
      else case when v_job.calendar_state = 'added' then 'cancel' end
    end;
    if v_action is null then
      update public.outbox_jobs set status = 'done', locked_until = null, last_error = 'nothing_to_send'
      where id = p_job;
      return pg_catalog.jsonb_build_object('kind', 'done');
    end if;
  elsif v_job.unsubscribed_at is not null or v_job.meeting_status <> 'scheduled' or v_job.starts_at <= pg_catalog.now() then
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
    payload = case when v_job.kind = 'calendar_confirm'
      then pg_catalog.jsonb_build_object('action', v_action, 'sequence', v_job.calendar_sequence)
      else payload end
  where id = p_job;
  -- The personal links must work in any email that may have gone out, including one whose outcome
  -- ends up "unknown" (the token is derived from the invitee id, so storing it early is safe).
  if p_token_hash is not null then
    update public.meeting_invitees set token_hash = coalesce(token_hash, p_token_hash) where id = v_job.invitee_id;
  end if;
  if v_job.kind = 'calendar_confirm' then
    return pg_catalog.jsonb_build_object('kind', 'ok', 'calendar',
      pg_catalog.jsonb_build_object('action', v_action, 'sequence', v_job.calendar_sequence));
  end if;
  return pg_catalog.jsonb_build_object('kind', 'ok');
end;
$$;

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
  if p_outcome = 'failed' then
    delete from public.send_log s where s.job_id = p_job;
  end if;
  if v_kind = 'calendar_confirm' then
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

create or replace function public.dispatch_retry(p_job uuid, p_error text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempts integer;
  v_invitee uuid;
  v_kind public.job_kind;
  v_retry timestamptz;
begin
  select j.attempts, j.invitee_id, j.kind into v_attempts, v_invitee, v_kind
  from public.outbox_jobs j where j.id = p_job and j.status = 'processing' for update;
  if v_attempts is null then
    return pg_catalog.jsonb_build_object('kind', 'gone');
  end if;
  delete from public.send_log s where s.job_id = p_job;
  if v_attempts >= private.app_limit('dispatch_job_max_attempts') then
    update public.outbox_jobs set status = 'failed', last_error = p_error, locked_until = null, send_started_at = null
    where id = p_job;
    if v_kind = 'invite' then
      update public.meeting_invitees set email_status = 'failed', email_error = p_error where id = v_invitee;
    end if;
    return pg_catalog.jsonb_build_object('kind', 'failed');
  end if;
  v_retry := pg_catalog.now() + pg_catalog.make_interval(mins => (2 ^ (v_attempts - 1))::integer);
  update public.outbox_jobs
  set status = 'pending', run_after = v_retry, last_error = p_error, locked_until = null, run_id = null, send_started_at = null
  where id = p_job;
  return pg_catalog.jsonb_build_object('kind', 'retry', 'retry_at', v_retry);
end;
$$;

-- meeting_progress: latest body from 20261007205641_m4_outbox.sql; paused / resumes_at count invites only.
create or replace function private.meeting_progress(p_meeting uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
begin
  select m.workspace_id into v_workspace from public.meetings m where m.id = p_meeting;
  if v_workspace is null or not private.is_member(v_workspace) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  return pg_catalog.jsonb_build_object(
    'counts', (
      select pg_catalog.jsonb_build_object(
        'total', count(*),
        'queued', count(*) filter (where i.email_status = 'queued'),
        'sent', count(*) filter (where i.email_status = 'sent'),
        'skipped', count(*) filter (where i.email_status = 'skipped'),
        'failed', count(*) filter (where i.email_status = 'failed'),
        'unknown', count(*) filter (where i.email_status = 'unknown')
      )
      from public.meeting_invitees i where i.meeting_id = p_meeting
    ),
    'paused', (
      select count(*) from public.outbox_jobs j
      join public.meeting_invitees i on i.id = j.invitee_id
      where i.meeting_id = p_meeting and j.kind = 'invite' and j.status = 'paused'
    ),
    'resumes_at', (
      select min(j.run_after) from public.outbox_jobs j
      join public.meeting_invitees i on i.id = j.invitee_id
      where i.meeting_id = p_meeting and j.kind = 'invite' and j.status = 'pending'
        and j.run_after > pg_catalog.now() + interval '2 minutes'
    ),
    'sender_state', (
      select case when c.id is null then 'missing' when c.status = 'broken' then 'broken' else 'ok' end
      from public.workspaces w left join public.google_connections c on c.id = w.sender_connection_id
      where w.id = v_workspace
    ),
    'invitees', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', i.id, 'contact_id', c.id, 'full_name', c.full_name, 'email', c.email,
          'status', i.email_status, 'error', i.email_error, 'sent_at', i.sent_at
        )
        order by lower(c.full_name), c.email
      )
      from public.meeting_invitees i join public.contacts c on c.id = i.contact_id
      where i.meeting_id = p_meeting
    ), '[]'::jsonb)
  );
end;
$$;
