-- M4 outbox and dispatcher (spec §6 Integrations & pipeline, §7.2, §8).

insert into private.app_limits (name, value) values
  ('gmail_sends_per_minute', 60),
  ('dispatch_job_max_attempts', 6);

create type public.job_kind as enum
  ('invite', 'calendar_confirm', 'update', 'cancel', 'reminder', 'sheet_sync', 'push', 'system_email');
create type public.job_status as enum ('pending', 'processing', 'done', 'failed', 'paused');

create table public.outbox_jobs (
  id uuid primary key default gen_random_uuid(),
  kind public.job_kind not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  invitee_id uuid references public.meeting_invitees (id) on delete cascade,
  payload jsonb not null default '{}',
  idempotency_key text not null unique,
  run_after timestamptz not null default now(),
  status public.job_status not null default 'pending',
  attempts integer not null default 0 check (attempts >= 0),
  locked_until timestamptz,
  run_id uuid,
  send_started_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index outbox_jobs_due_idx on public.outbox_jobs (status, run_after);
create index outbox_jobs_workspace_status_idx on public.outbox_jobs (workspace_id, status);
create index outbox_jobs_invitee_idx on public.outbox_jobs (invitee_id);
create index outbox_jobs_run_idx on public.outbox_jobs (run_id) where run_id is not null;
create trigger outbox_jobs_set_updated_at
  before update on public.outbox_jobs
  for each row execute function private.set_updated_at();

alter table public.send_log
  add constraint send_log_job_fk foreign key (job_id) references public.outbox_jobs (id) on delete set null;

create table public.sender_leases (
  google_sub text primary key,
  run_id uuid not null,
  locked_until timestamptz not null
);

alter table public.outbox_jobs enable row level security;
alter table public.sender_leases enable row level security;
revoke all on table public.outbox_jobs, public.sender_leases from anon, authenticated;
grant all on table public.outbox_jobs, public.sender_leases to service_role;

-- Paused jobs resume as soon as their workspace has a usable sender again (spec §8).
create function private.resume_paused_jobs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'workspaces' then
    if new.sender_connection_id is not null then
      update public.outbox_jobs j set status = 'pending', run_after = pg_catalog.now(), last_error = null
      where j.workspace_id = new.id and j.status = 'paused';
    end if;
  elsif new.status = 'active' and old.status = 'broken' then
    update public.outbox_jobs j set status = 'pending', run_after = pg_catalog.now(), last_error = null
    where j.status = 'paused'
      and j.workspace_id in (select w.id from public.workspaces w where w.sender_connection_id = new.id);
  end if;
  return null;
end;
$$;
create trigger workspaces_resume_jobs
  after update of sender_connection_id on public.workspaces
  for each row execute function private.resume_paused_jobs();
create trigger google_connections_resume_jobs
  after update of status on public.google_connections
  for each row execute function private.resume_paused_jobs();

create function private.send_meeting(p_meeting uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meeting public.meetings;
  v_sender public.google_connections;
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
  if v_meeting.title = ''
    or v_meeting.starts_at is null
    or (v_meeting.location_mode in ('in_person', 'hybrid') and v_meeting.location_text = '')
    or (v_meeting.location_mode in ('online', 'hybrid') and v_meeting.meeting_url = '')
    or (v_meeting.response_mode = 'attendance' and pg_catalog.cardinality(v_meeting.delay_options) = 0)
    or (v_meeting.response_deadline is not null
        and (v_meeting.response_deadline > v_meeting.starts_at or v_meeting.response_deadline <= pg_catalog.now())) then
    raise exception 'tn:meeting_incomplete' using errcode = 'P0001';
  end if;
  if v_meeting.starts_at <= pg_catalog.now() then
    raise exception 'tn:meeting_in_past' using errcode = 'P0001';
  end if;
  select c.* into v_sender
  from public.workspaces w join public.google_connections c on c.id = w.sender_connection_id
  where w.id = v_meeting.workspace_id;
  if v_sender.id is null then
    raise exception 'tn:sender_not_connected' using errcode = 'P0001';
  end if;
  if v_sender.status <> 'active' then
    raise exception 'tn:sender_broken' using errcode = 'P0001';
  end if;

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
  return pg_catalog.jsonb_build_object('invited', v_new, 'skipped_unsubscribed', v_skipped);
end;
$$;

create function private.meeting_progress(p_meeting uuid)
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
      where i.meeting_id = p_meeting and j.status = 'paused'
    ),
    'resumes_at', (
      select min(j.run_after) from public.outbox_jobs j
      join public.meeting_invitees i on i.id = j.invitee_id
      where i.meeting_id = p_meeting and j.status = 'pending' and j.run_after > pg_catalog.now() + interval '2 minutes'
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

create function public.send_meeting(p_meeting uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.send_meeting(p_meeting) $$;

create function public.meeting_progress(p_meeting uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.meeting_progress(p_meeting) $$;

-- Dispatcher (service role only; spec §8). One run owns one Google account at a time.
create function public.dispatch_claim(p_run uuid, p_limit integer, p_lease_seconds integer)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_connection public.google_connections;
  v_lease interval := pg_catalog.make_interval(secs => p_lease_seconds);
  v_rows integer;
begin
  -- A lease expired after the email may have reached Gmail: never resend (at most once).
  with lost as (
    update public.outbox_jobs j
    set status = 'failed', last_error = 'delivery_unknown', locked_until = null
    where j.status = 'processing' and j.locked_until < pg_catalog.now() and j.send_started_at is not null
    returning j.invitee_id
  )
  update public.meeting_invitees i set email_status = 'unknown', email_error = 'delivery_unknown'
  from lost where i.id = lost.invitee_id;

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
          'attempts', j.attempts,
          'invitee_id', i.id,
          'workspace_id', w.id,
          'workspace_name', w.name,
          'contact', pg_catalog.jsonb_build_object('full_name', c.full_name, 'email', c.email),
          'meeting', pg_catalog.jsonb_build_object(
            'id', m.id, 'title', m.title, 'agenda_md', m.agenda_md, 'starts_at', m.starts_at,
            'duration_minutes', m.duration_minutes, 'timezone', m.timezone, 'location_mode', m.location_mode,
            'location_text', m.location_text, 'meeting_url', m.meeting_url, 'response_mode', m.response_mode,
            'response_deadline', m.response_deadline, 'footer_note', m.footer_note,
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

create function public.dispatch_reserve(p_job uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_job record;
  v_count integer;
  v_oldest timestamptz;
  v_retry timestamptz;
begin
  select j.id, j.status, j.workspace_id, j.invitee_id, c.google_sub, m.status as meeting_status, m.starts_at,
    ct.unsubscribed_at
  into v_job
  from public.outbox_jobs j
  join public.workspaces w on w.id = j.workspace_id
  join public.google_connections c on c.id = w.sender_connection_id
  join public.meeting_invitees i on i.id = j.invitee_id
  join public.meetings m on m.id = i.meeting_id
  join public.contacts ct on ct.id = i.contact_id
  where j.id = p_job
  for update of j;
  if v_job.id is null or v_job.status <> 'processing' then
    return pg_catalog.jsonb_build_object('kind', 'gone');
  end if;

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
  update public.outbox_jobs set send_started_at = pg_catalog.now() where id = p_job;
  return pg_catalog.jsonb_build_object('kind', 'ok');
end;
$$;

create function public.dispatch_finish(
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
begin
  update public.outbox_jobs
  set status = case when p_outcome in ('sent', 'skipped') then 'done'::public.job_status else 'failed'::public.job_status end,
    last_error = p_error, locked_until = null
  where id = p_job and status = 'processing'
  returning invitee_id into v_invitee;
  if v_invitee is null then
    return;
  end if;
  if p_outcome = 'failed' then
    delete from public.send_log s where s.job_id = p_job;
  end if;
  update public.meeting_invitees
  set email_status = p_outcome,
    email_error = p_error,
    sent_at = case when p_outcome = 'sent' then pg_catalog.now() end,
    token_hash = case when p_outcome = 'sent' then coalesce(token_hash, p_token_hash) else token_hash end
  where id = v_invitee;
end;
$$;

create function public.dispatch_retry(p_job uuid, p_error text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempts integer;
  v_invitee uuid;
  v_retry timestamptz;
begin
  select j.attempts, j.invitee_id into v_attempts, v_invitee
  from public.outbox_jobs j where j.id = p_job and j.status = 'processing' for update;
  if v_attempts is null then
    return pg_catalog.jsonb_build_object('kind', 'gone');
  end if;
  delete from public.send_log s where s.job_id = p_job;
  if v_attempts >= private.app_limit('dispatch_job_max_attempts') then
    update public.outbox_jobs set status = 'failed', last_error = p_error, locked_until = null, send_started_at = null
    where id = p_job;
    update public.meeting_invitees set email_status = 'failed', email_error = p_error where id = v_invitee;
    return pg_catalog.jsonb_build_object('kind', 'failed');
  end if;
  v_retry := pg_catalog.now() + pg_catalog.make_interval(mins => (2 ^ (v_attempts - 1))::integer);
  update public.outbox_jobs
  set status = 'pending', run_after = v_retry, last_error = p_error, locked_until = null, run_id = null, send_started_at = null
  where id = p_job;
  return pg_catalog.jsonb_build_object('kind', 'retry', 'retry_at', v_retry);
end;
$$;

create function public.dispatch_unclaim(p_jobs uuid[])
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.outbox_jobs
  set status = 'pending', attempts = greatest(attempts - 1, 0), locked_until = null, run_id = null
  where id = any (p_jobs) and status = 'processing' and send_started_at is null;
$$;

create function public.dispatch_defer_sender(p_run uuid, p_connection uuid, p_until timestamptz, p_error text)
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
    or (j.status = 'pending' and j.workspace_id in (
      select w.id from public.workspaces w where w.sender_connection_id = p_connection
    ));
end;
$$;

create function private.dispatch_mark_broken(p_run uuid, p_connection uuid, p_reason text)
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
    or (j.status = 'pending' and j.workspace_id in (
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

create function public.dispatch_mark_broken(p_run uuid, p_connection uuid, p_reason text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.dispatch_mark_broken(p_run, p_connection, p_reason) $$;

create function public.dispatch_set_thread(p_meeting uuid, p_connection uuid, p_thread_id text, p_root_message_id text)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.meetings
  set gmail_thread_id = p_thread_id, gmail_root_message_id = p_root_message_id, thread_connection_id = p_connection
  where id = p_meeting;
$$;

create function public.dispatch_release(p_run uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from public.sender_leases l where l.run_id = p_run;
$$;

-- Supabase Cron (S1): call the dispatcher only when something is due. Vault holds the URL and
-- secret on production only, so local, CI and preview projects never call out.
create function private.kick_dispatcher()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if not exists (
    select 1 from public.outbox_jobs j
    where (j.status = 'pending' and j.run_after <= pg_catalog.now())
      or (j.status = 'processing' and j.locked_until < pg_catalog.now())
  ) then
    return;
  end if;
  select s.decrypted_secret into v_url from vault.decrypted_secrets s where s.name = 'tn_dispatch_url';
  select s.decrypted_secret into v_secret from vault.decrypted_secrets s where s.name = 'tn_dispatch_secret';
  if v_url is null or v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := pg_catalog.jsonb_build_object('Authorization', 'Bearer ' || v_secret, 'Content-Type', 'application/json'),
    timeout_milliseconds := 10000
  );
end;
$$;

create or replace function private.housekeeping()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.rate_limit_events e where e.occurred_at < pg_catalog.now() - interval '2 days';
  delete from public.outbox_jobs j where j.status in ('done', 'failed') and j.updated_at < pg_catalog.now() - interval '30 days';
  delete from public.send_log s where s.sent_at < pg_catalog.now() - interval '30 days';
  delete from public.sender_leases l where l.locked_until < pg_catalog.now() - interval '1 day';
  -- "+" creates a draft at once (grilling 2026-10-07); one left untitled and undated is litter.
  delete from public.meetings m
  where m.status = 'draft' and m.title = '' and m.starts_at is null and m.created_at < pg_catalog.now() - interval '24 hours';
end;
$$;

revoke execute on all functions in schema private from public, anon;
revoke execute on function private.kick_dispatcher(), private.housekeeping(), private.dispatch_mark_broken(uuid, uuid, text)
  from authenticated, service_role;
grant execute on function private.send_meeting(uuid), private.meeting_progress(uuid) to authenticated;
grant execute on function private.dispatch_mark_broken(uuid, uuid, text) to service_role;

revoke execute on function public.send_meeting(uuid), public.meeting_progress(uuid) from public, anon;
grant execute on function public.send_meeting(uuid), public.meeting_progress(uuid) to authenticated;

revoke execute on function
  public.dispatch_claim(uuid, integer, integer),
  public.dispatch_reserve(uuid),
  public.dispatch_finish(uuid, public.invitee_email_status, text, text),
  public.dispatch_retry(uuid, text),
  public.dispatch_unclaim(uuid[]),
  public.dispatch_defer_sender(uuid, uuid, timestamptz, text),
  public.dispatch_mark_broken(uuid, uuid, text),
  public.dispatch_set_thread(uuid, uuid, text, text),
  public.dispatch_release(uuid)
from public, anon, authenticated;
grant execute on function
  public.dispatch_claim(uuid, integer, integer),
  public.dispatch_reserve(uuid),
  public.dispatch_finish(uuid, public.invitee_email_status, text, text),
  public.dispatch_retry(uuid, text),
  public.dispatch_unclaim(uuid[]),
  public.dispatch_defer_sender(uuid, uuid, timestamptz, text),
  public.dispatch_mark_broken(uuid, uuid, text),
  public.dispatch_set_thread(uuid, uuid, text, text),
  public.dispatch_release(uuid)
to service_role;
-- The invoker dispatcher functions call these as service_role.
grant execute on function private.app_limit(text), private.audience_members(uuid) to service_role;

select cron.schedule('tn-dispatch', '* * * * *', $$select private.kick_dispatcher()$$);
