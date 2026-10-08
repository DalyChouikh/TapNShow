-- Online place (owner decision 2026-10-08): an online or hybrid meeting says where online in words
-- (e.g. "Club Discord, Meetings voice channel") and/or gives a link; at least one is needed to send.
-- Workspaces keep a usual online place that pre-fills new meetings.

alter table public.meetings
  add column online_text text not null default ''
    check (online_text = btrim(online_text) and char_length(online_text) <= 200);
grant update (online_text) on table public.meetings to authenticated;

alter table public.workspaces
  add column default_online_text text not null default ''
    check (default_online_text = btrim(default_online_text) and char_length(default_online_text) <= 200),
  add column default_meeting_url text not null default ''
    check (default_meeting_url = '' or (default_meeting_url ~ '^https?://[^[:space:]]+$' and char_length(default_meeting_url) <= 500));
grant update (default_online_text, default_meeting_url) on table public.workspaces to authenticated;

create or replace function private.create_meeting(p_workspace uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_member(p_workspace, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if not private.hit_user_rate_limit('meeting_create') then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;
  insert into public.meetings (
    workspace_id, duration_minutes, timezone, response_mode, delay_options, reason_required,
    comments_enabled, footer_note, online_text, meeting_url, created_by
  )
  select w.id, w.default_duration_minutes, w.timezone, w.default_response_mode, w.default_delay_options,
    w.default_reason_required, w.default_comments_enabled, w.default_footer_note,
    w.default_online_text, w.default_meeting_url, auth.uid()
  from public.workspaces w
  where w.id = p_workspace
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function private.send_meeting(p_meeting uuid)
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
    or (v_meeting.location_mode in ('online', 'hybrid') and v_meeting.meeting_url = '' and v_meeting.online_text = '')
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
            'location_text', m.location_text, 'online_text', m.online_text, 'meeting_url', m.meeting_url, 'response_mode', m.response_mode,
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
    'unsubscribed', c.unsubscribed_at is not null,
    'reported', c.unsubscribed_via is not distinct from 'report',
    'meeting', pg_catalog.jsonb_build_object(
      'title', m.title, 'starts_at', m.starts_at, 'timezone', m.timezone, 'duration_minutes', m.duration_minutes,
      'location_mode', m.location_mode, 'location_text', m.location_text, 'online_text', m.online_text,
      'meeting_url', m.meeting_url,
      'status', m.status
    )
  )
  from public.meeting_invitees i
  join public.contacts c on c.id = i.contact_id
  join public.meetings m on m.id = i.meeting_id
  join public.workspaces w on w.id = i.workspace_id
  where i.token_hash = p_token_hash;
$$;
