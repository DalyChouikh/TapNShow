-- M7 Google Sheet worker (spec §8): change marks, the claim and write functions, one "is it due"
-- rule per worker, the shared wake-up, and the daily repair mark.

insert into private.app_limits (name, value) values
  ('sheet_quiet_seconds', 60),
  ('sheet_max_wait_seconds', 300),
  ('sheet_retry_max_minutes', 30);

alter table public.sheet_syncs
  add column last_error text check (last_error is null or char_length(last_error) <= 200);
create index sheet_syncs_due_idx on public.sheet_syncs (retry_at) where status = 'active';

-- Marks the years of these meetings (sent ones that ask for answers).
create function private.sheet_mark_meetings(p_meetings uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  select private.sheet_mark(pg_catalog.array_agg(m.workspace_id), pg_catalog.array_agg(private.sheet_year(m.starts_at, m.timezone)))
  from public.meetings m
  where m.id = any (p_meetings) and m.status <> 'draft' and m.response_mode <> 'announcement' and m.starts_at is not null
$$;

-- Marks the years of every meeting these contacts were invited to.
create function private.sheet_mark_contacts(p_contacts uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  select private.sheet_mark_meetings(pg_catalog.array_agg(distinct i.meeting_id))
  from public.meeting_invitees i
  where i.contact_id = any (p_contacts)
$$;

-- One trigger function per table; transition tables need one trigger per event, so each function
-- branches on TG_OP (PL/pgSQL plans a statement only when it runs, so the unused table names are fine).
-- Every function returns early while no workspace has a sheet.

create function private.sheet_meetings_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.sheet_syncs) then
    return null;
  end if;
  if TG_OP = 'DELETE' then
    perform private.sheet_mark(pg_catalog.array_agg(o.workspace_id), pg_catalog.array_agg(private.sheet_year(o.starts_at, o.timezone)))
    from old_rows o
    where o.status <> 'draft' and o.response_mode <> 'announcement' and o.starts_at is not null;
  else
    perform private.sheet_mark(pg_catalog.array_agg(x.workspace_id), pg_catalog.array_agg(x.year))
    from (
      select o.workspace_id, private.sheet_year(o.starts_at, o.timezone) as year
      from old_rows o join new_rows n on n.id = o.id
      where (o.title, o.starts_at, o.timezone, o.status) is distinct from (n.title, n.starts_at, n.timezone, n.status)
        and o.status <> 'draft' and o.response_mode <> 'announcement' and o.starts_at is not null
      union all
      select n.workspace_id, private.sheet_year(n.starts_at, n.timezone)
      from old_rows o join new_rows n on n.id = o.id
      where (o.title, o.starts_at, o.timezone, o.status) is distinct from (n.title, n.starts_at, n.timezone, n.status)
        and n.status <> 'draft' and n.response_mode <> 'announcement' and n.starts_at is not null
    ) x;
  end if;
  return null;
end;
$$;
create trigger sheet_meetings_updated after update on public.meetings
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.sheet_meetings_changed();
create trigger sheet_meetings_deleted after delete on public.meetings
  referencing old table as old_rows
  for each statement execute function private.sheet_meetings_changed();

-- Invitees: added, removed, or their email status changed.
create function private.sheet_invitees_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.sheet_syncs) then
    return null;
  end if;
  if TG_OP = 'INSERT' then
    perform private.sheet_mark_meetings(array(select distinct n.meeting_id from new_rows n));
  elsif TG_OP = 'DELETE' then
    perform private.sheet_mark_meetings(array(select distinct o.meeting_id from old_rows o));
  else
    perform private.sheet_mark_meetings(array(
      select distinct n.meeting_id from new_rows n join old_rows o on o.id = n.id
      where o.email_status is distinct from n.email_status));
  end if;
  return null;
end;
$$;
create trigger sheet_invitees_inserted after insert on public.meeting_invitees
  referencing new table as new_rows for each statement execute function private.sheet_invitees_changed();
create trigger sheet_invitees_updated after update on public.meeting_invitees
  referencing old table as old_rows new table as new_rows for each statement execute function private.sheet_invitees_changed();
create trigger sheet_invitees_deleted after delete on public.meeting_invitees
  referencing old table as old_rows for each statement execute function private.sheet_invitees_changed();

-- Answers and check-ins: any write.
create function private.sheet_rows_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.sheet_syncs) then
    return null;
  end if;
  if TG_OP = 'DELETE' then
    perform private.sheet_mark_meetings(array(select distinct o.meeting_id from old_rows o));
  else
    perform private.sheet_mark_meetings(array(select distinct n.meeting_id from new_rows n));
  end if;
  return null;
end;
$$;
create trigger sheet_responses_inserted after insert on public.responses
  referencing new table as new_rows for each statement execute function private.sheet_rows_changed();
create trigger sheet_responses_updated after update on public.responses
  referencing new table as new_rows for each statement execute function private.sheet_rows_changed();
create trigger sheet_responses_deleted after delete on public.responses
  referencing old table as old_rows for each statement execute function private.sheet_rows_changed();
create trigger sheet_marks_inserted after insert on public.attendance_marks
  referencing new table as new_rows for each statement execute function private.sheet_rows_changed();
create trigger sheet_marks_updated after update on public.attendance_marks
  referencing new table as new_rows for each statement execute function private.sheet_rows_changed();
create trigger sheet_marks_deleted after delete on public.attendance_marks
  referencing old table as old_rows for each statement execute function private.sheet_rows_changed();

-- Contacts: name or email (deleting one cascades to its invitees, whose trigger marks).
create function private.sheet_contacts_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.sheet_syncs) then
    return null;
  end if;
  perform private.sheet_mark_contacts(array(
    select n.id from new_rows n join old_rows o on o.id = n.id
    where (o.full_name, o.email) is distinct from (n.full_name, n.email)));
  return null;
end;
$$;
create trigger sheet_contacts_updated after update on public.contacts
  referencing old table as old_rows new table as new_rows for each statement execute function private.sheet_contacts_changed();

-- List memberships (the Lists column).
create function private.sheet_memberships_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.sheet_syncs) then
    return null;
  end if;
  if TG_OP = 'DELETE' then
    perform private.sheet_mark_contacts(array(select distinct o.contact_id from old_rows o));
  else
    perform private.sheet_mark_contacts(array(select distinct n.contact_id from new_rows n));
  end if;
  return null;
end;
$$;
create trigger sheet_memberships_inserted after insert on public.list_contacts
  referencing new table as new_rows for each statement execute function private.sheet_memberships_changed();
create trigger sheet_memberships_deleted after delete on public.list_contacts
  referencing old table as old_rows for each statement execute function private.sheet_memberships_changed();

-- A list's name or the workspace's name: every year that has a tab.
create function private.sheet_names_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.sheet_syncs) then
    return null;
  end if;
  if TG_TABLE_NAME = 'lists' then
    perform private.sheet_mark_all(array(
      select distinct n.workspace_id from new_rows n join old_rows o on o.id = n.id where o.name is distinct from n.name));
  else
    perform private.sheet_mark_all(array(
      select n.id from new_rows n join old_rows o on o.id = n.id where o.name is distinct from n.name));
  end if;
  return null;
end;
$$;
create trigger sheet_lists_updated after update on public.lists
  referencing old table as old_rows new table as new_rows for each statement execute function private.sheet_names_changed();
create trigger sheet_workspaces_updated after update on public.workspaces
  referencing old table as old_rows new table as new_rows for each statement execute function private.sheet_names_changed();

-- "Is this sheet due?" (spec §8): active, not leased, past its retry time, and either without a
-- file yet or with a year that changed at least a quiet minute ago (or first changed 5 minutes ago).
create function private.sheet_due(p_sheet public.sheet_syncs)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_sheet.status = 'active'
    and (p_sheet.locked_until is null or p_sheet.locked_until < pg_catalog.now())
    and p_sheet.retry_at <= pg_catalog.now()
    and (p_sheet.spreadsheet_id is null or exists (
      select 1 from public.sheet_dirty_years d
      where d.workspace_id = p_sheet.workspace_id
        and (d.changed_at <= pg_catalog.now() - pg_catalog.make_interval(secs => private.app_limit('sheet_quiet_seconds'))
          or d.first_changed_at <= pg_catalog.now() - pg_catalog.make_interval(secs => private.app_limit('sheet_max_wait_seconds')))))
$$;

-- An update or a cancellation waits for that person's invite, still being sent (M6). One rule for
-- dispatch_claim and the wake-up.
create function private.job_held(p_kind public.job_kind, p_invitee uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_kind in ('update', 'cancel') and exists (
    select 1 from public.meeting_invitees qi where qi.id = p_invitee and qi.email_status = 'queued')
$$;

-- What the per-minute wake-up checks: an email job due (and not held), an expired lease, or a sheet due.
create function private.workers_due()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.outbox_jobs j
      where (j.status = 'pending' and j.run_after <= pg_catalog.now() and not private.job_held(j.kind, j.invitee_id))
        or (j.status = 'processing' and j.locked_until < pg_catalog.now()))
    or exists (select 1 from public.sheet_syncs s where private.sheet_due(s))
$$;

-- kick_dispatcher: latest body from 20261007205641_m4_outbox.sql; it now wakes the route when either
-- worker has something to do (one rule, private.workers_due), so held updates no longer wake it every
-- minute (#255).
create or replace function private.kick_dispatcher()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if not private.workers_due() then
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

-- dispatch_claim: latest body from 20261009235635_m6_edit_cancel.sql; the two inline "held behind a
-- queued invite" checks are now private.job_held (the same rule the wake-up uses).
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
    -- An update or a cancellation waits for that person's invite, still being sent.
      and not private.job_held(j.kind, j.invitee_id)
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
      -- An update or a cancellation waits for that person's invite, still being sent.
      and not private.job_held(j.kind, j.invitee_id)
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

-- housekeeping: latest body from 20261007205641_m4_outbox.sql, plus the daily repair mark.
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
  -- The current year of every sheet is redrawn once a day, so edits made in the sheet are repaired.
  perform private.sheet_mark(pg_catalog.array_agg(s.workspace_id), pg_catalog.array_agg(private.sheet_year(pg_catalog.now(), w.timezone)))
  from public.sheet_syncs s join public.workspaces w on w.id = s.workspace_id
  where s.spreadsheet_id is not null;
end;
$$;

create function public.sheet_claim(p_run uuid, p_limit integer, p_lease_seconds integer)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  with picked as (
    select s.workspace_id from public.sheet_syncs s
    where s.status = 'active' and private.sheet_due(s)
    order by s.retry_at
    limit p_limit
    for update of s skip locked
  ), leased as (
    update public.sheet_syncs s
    set run_id = p_run, locked_until = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds)
    from picked where s.workspace_id = picked.workspace_id
    returning s.*
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'workspace_id', l.workspace_id, 'workspace_name', w.name, 'workspace_slug', w.slug,
    'timezone', w.timezone, 'locale', w.locale, 'spreadsheet_id', l.spreadsheet_id, 'create_key', l.create_key,
    'connection', case when c.id is null then null else pg_catalog.jsonb_build_object(
      'id', c.id, 'user_id', c.user_id, 'google_sub', c.google_sub,
      'refresh_token_encrypted', c.refresh_token_encrypted, 'granted_scopes', c.granted_scopes) end,
    'years', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('year', d.year, 'version', d.version) order by d.year desc)
      from public.sheet_dirty_years d where d.workspace_id = l.workspace_id), '[]'::jsonb),
    'tabs', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'tab_key', t.tab_key, 'year', t.year, 'google_sheet_id', t.google_sheet_id, 'title', t.title,
        'content_hash', t.content_hash, 'row_count', t.row_count, 'format_version', t.format_version)
        order by t.year desc, t.tab_key)
      from public.sheet_tabs t where t.workspace_id = l.workspace_id), '[]'::jsonb)
  )), '[]'::jsonb)
  into v_rows
  from leased l
  join public.workspaces w on w.id = l.workspace_id
  left join public.google_connections c on c.id = l.connection_id;
  return v_rows;
end;
$$;

-- One year's rows (spec §7.17): the Attendance Details shape plus the meeting's status and the
-- person's list names (sorted like the roster), newest meeting first, then name.
create function public.sheet_rows(p_workspace uuid, p_year integer)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with lists as (
    select lc.contact_id, pg_catalog.array_agg(l.name order by lower(l.name)) as names
    from public.list_contacts lc join public.lists l on l.id = lc.list_id
    where lc.workspace_id = p_workspace
    group by lc.contact_id
  ), sheet as (
    select m.id as meeting_id, m.title, m.starts_at, m.timezone, m.response_mode, m.status as meeting_status,
      i.id as invitee_id, c.id as contact_id, c.full_name, c.email, lower(c.full_name) as sort_name, i.email_status,
      case when r.id is null then null else pg_catalog.jsonb_build_object(
        'status', r.status, 'delay_minutes', r.delay_minutes, 'reason', r.reason, 'comment', r.comment,
        'after_deadline', r.after_deadline, 'updated_at', r.updated_at,
        'needs_reconfirmation', r.needs_reconfirmation) end as answer,
      private.mark_json(am, mp.display_name) as mark,
      coalesce(ls.names, '{}'::text[]) as lists
    from public.meetings m
    join public.meeting_invitees i on i.meeting_id = m.id
    join public.contacts c on c.id = i.contact_id
    left join public.responses r on r.invitee_id = i.id
    left join public.attendance_marks am on am.invitee_id = i.id
    left join public.profiles mp on mp.user_id = am.marked_by
    left join lists ls on ls.contact_id = c.id
    where m.workspace_id = p_workspace and m.status in ('scheduled', 'cancelled') and m.response_mode <> 'announcement'
      and m.starts_at >= pg_catalog.make_timestamptz(p_year, 1, 1, 0, 0, 0, 'UTC') - interval '1 day'
      and m.starts_at < pg_catalog.make_timestamptz(p_year + 1, 1, 1, 0, 0, 0, 'UTC') + interval '1 day'
      and private.sheet_year(m.starts_at, m.timezone) = p_year
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(sheet)
    order by sheet.starts_at desc, sheet.meeting_id, sheet.sort_name, sheet.invitee_id), '[]'::jsonb)
  from sheet
$$;

create function public.sheet_save_file(p_workspace uuid, p_run uuid, p_spreadsheet_id text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.sheet_syncs set spreadsheet_id = p_spreadsheet_id
  where workspace_id = p_workspace and run_id = p_run;
  return found;
end;
$$;

create function public.sheet_save_tab(p_workspace uuid, p_run uuid, p_tab jsonb)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (select 1 from public.sheet_syncs s where s.workspace_id = p_workspace and s.run_id = p_run) then
    return false;
  end if;
  insert into public.sheet_tabs (workspace_id, tab_key, year, google_sheet_id, title, starts_from, starts_to,
    content_hash, row_count, format_version)
  values (p_workspace, p_tab ->> 'tab_key', (p_tab ->> 'year')::integer, (p_tab ->> 'google_sheet_id')::integer,
    p_tab ->> 'title', (p_tab ->> 'starts_from')::timestamptz, (p_tab ->> 'starts_to')::timestamptz,
    p_tab ->> 'content_hash', (p_tab ->> 'row_count')::integer, (p_tab ->> 'format_version')::integer)
  on conflict (workspace_id, tab_key) do update set
    year = excluded.year, google_sheet_id = excluded.google_sheet_id, title = excluded.title,
    starts_from = excluded.starts_from, starts_to = excluded.starts_to, content_hash = excluded.content_hash,
    row_count = excluded.row_count, format_version = excluded.format_version;
  return true;
end;
$$;

create function public.sheet_drop_tabs(p_workspace uuid, p_run uuid, p_keys text[])
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from public.sheet_tabs t
  where t.workspace_id = p_workspace and t.tab_key = any (p_keys)
    and exists (select 1 from public.sheet_syncs s where s.workspace_id = p_workspace and s.run_id = p_run)
$$;

-- Clears a year only if nothing changed since the claim read it (spec §8): a change during the write
-- raised the version, so the year stays marked and the next run redraws it.
create function public.sheet_finish_year(p_workspace uuid, p_run uuid, p_year integer, p_version bigint)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.sheet_dirty_years d
  where d.workspace_id = p_workspace and d.year = p_year and d.version = p_version
    and exists (select 1 from public.sheet_syncs s where s.workspace_id = p_workspace and s.run_id = p_run);
  return found;
end;
$$;

create function public.sheet_release(p_workspace uuid, p_run uuid, p_synced boolean)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.sheet_syncs
  set run_id = null, locked_until = null,
    synced_at = case when p_synced then pg_catalog.now() else synced_at end,
    attempts = case when p_synced then 0 else attempts end,
    last_error = case when p_synced then null else last_error end
  where workspace_id = p_workspace and run_id = p_run
$$;

-- Backoff after a Google error or a 429: 1, 2, 4… minutes up to sheet_retry_max_minutes, plus up to
-- 30 s of jitter (Sheets API usage limits: exponential backoff).
create function public.sheet_retry(p_workspace uuid, p_run uuid, p_error text)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.sheet_syncs
  set attempts = attempts + 1, last_error = left(p_error, 200), run_id = null, locked_until = null,
    retry_at = pg_catalog.now()
      + pg_catalog.make_interval(mins => least(private.app_limit('sheet_retry_max_minutes'), (2 ^ least(attempts, 10))::integer))
      + pg_catalog.make_interval(secs => pg_catalog.random() * 30)
  where workspace_id = p_workspace and run_id = p_run
$$;

-- Pause with a reason (spec §7.17); one platform email per pause (no second one within 24 h), on
-- the same platform budget as the M4 sender alert.
create function private.sheet_pause(p_workspace uuid, p_run uuid, p_reason public.sheet_pause_reason)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sheet public.sheet_syncs;
begin
  update public.sheet_syncs
  set status = 'paused', paused_reason = p_reason, paused_at = pg_catalog.now(), run_id = null, locked_until = null
  where workspace_id = p_workspace and run_id = p_run
  returning * into v_sheet;
  if v_sheet.workspace_id is null
    or (v_sheet.alerted_at is not null and v_sheet.alerted_at > pg_catalog.now() - interval '24 hours')
    or not private.hit_rate_limit('invite_email:platform', private.app_limit('invite_email_platform_per_day'), interval '24 hours') then
    return null;
  end if;
  update public.sheet_syncs set alerted_at = pg_catalog.now() where workspace_id = p_workspace;
  return (
    select pg_catalog.jsonb_build_object('email', u.email, 'workspace_name', w.name, 'workspace_slug', w.slug, 'reason', p_reason)
    from public.workspaces w
    join public.workspace_roles r on r.workspace_id = w.id and r.role = 'owner'
    join auth.users u on u.id = r.user_id
    where w.id = p_workspace
  );
end;
$$;
create function public.sheet_pause(p_workspace uuid, p_run uuid, p_reason public.sheet_pause_reason)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.sheet_pause(p_workspace, p_run, p_reason) $$;

revoke execute on function
  private.sheet_mark_meetings(uuid[]), private.sheet_mark_contacts(uuid[]),
  private.sheet_meetings_changed(), private.sheet_invitees_changed(), private.sheet_rows_changed(),
  private.sheet_contacts_changed(), private.sheet_memberships_changed(), private.sheet_names_changed(),
  private.sheet_due(public.sheet_syncs), private.job_held(public.job_kind, uuid), private.workers_due(),
  private.sheet_pause(uuid, uuid, public.sheet_pause_reason)
from public, anon, authenticated;
-- The invoker worker and dispatcher functions run as the service role.
grant execute on function private.sheet_due(public.sheet_syncs), private.job_held(public.job_kind, uuid),
  private.sheet_pause(uuid, uuid, public.sheet_pause_reason) to service_role;
revoke execute on function
  public.sheet_claim(uuid, integer, integer), public.sheet_rows(uuid, integer),
  public.sheet_save_file(uuid, uuid, text), public.sheet_save_tab(uuid, uuid, jsonb),
  public.sheet_drop_tabs(uuid, uuid, text[]), public.sheet_finish_year(uuid, uuid, integer, bigint),
  public.sheet_release(uuid, uuid, boolean), public.sheet_retry(uuid, uuid, text),
  public.sheet_pause(uuid, uuid, public.sheet_pause_reason)
from public, anon, authenticated;
grant execute on function
  public.sheet_claim(uuid, integer, integer), public.sheet_rows(uuid, integer),
  public.sheet_save_file(uuid, uuid, text), public.sheet_save_tab(uuid, uuid, jsonb),
  public.sheet_drop_tabs(uuid, uuid, text[]), public.sheet_finish_year(uuid, uuid, integer, bigint),
  public.sheet_release(uuid, uuid, boolean), public.sheet_retry(uuid, uuid, text),
  public.sheet_pause(uuid, uuid, public.sheet_pause_reason)
to service_role;
-- sheet_rows (invoker, service role) reads the mark and the year through these helpers.
grant execute on function private.mark_json(public.attendance_marks, text), private.sheet_year(timestamptz, text)
  to service_role;
