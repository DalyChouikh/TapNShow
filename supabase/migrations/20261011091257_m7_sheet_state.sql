-- M7 Google Sheet: state, tabs, change marks, the connection release rule, start and resume
-- (spec §6, §7.17, §9). The worker functions and the change triggers come in the next migration.

insert into private.app_limits (name, value) values
  ('sheet_retries_per_user_per_hour', 20),
  ('google_connects_per_user_per_hour', 20);

create type public.sheet_status as enum ('active', 'paused');
-- Twin: sheetPauseReasonSchema (src/shared/api/sheets.ts).
create type public.sheet_pause_reason as enum ('trashed', 'deleted', 'access_lost', 'full');

create table public.sheet_syncs (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  connection_id uuid references public.google_connections (id) on delete set null,
  google_sub text not null check (char_length(google_sub) between 1 and 255),
  google_email text not null check (char_length(google_email) between 3 and 320),
  create_key uuid not null default gen_random_uuid(),
  spreadsheet_id text check (spreadsheet_id is null or spreadsheet_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  status public.sheet_status not null default 'active',
  paused_reason public.sheet_pause_reason,
  paused_at timestamptz,
  alerted_at timestamptz,
  synced_at timestamptz,
  run_id uuid,
  locked_until timestamptz,
  retry_at timestamptz not null default now(),
  attempts integer not null default 0 check (attempts >= 0),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'paused') = (paused_reason is not null))
);
create index sheet_syncs_connection_idx on public.sheet_syncs (connection_id);
create index sheet_syncs_sub_idx on public.sheet_syncs (google_sub);
create trigger sheet_syncs_set_updated_at before update on public.sheet_syncs
  for each row execute function private.set_updated_at();

create table public.sheet_tabs (
  workspace_id uuid not null references public.sheet_syncs (workspace_id) on delete cascade,
  tab_key text not null check (tab_key ~ '^[0-9]{1,6}(-[0-9]{1,4})?$'),
  year integer not null,
  google_sheet_id integer not null,
  title text not null check (char_length(title) between 1 and 100),
  starts_from timestamptz,
  starts_to timestamptz,
  content_hash text not null check (char_length(content_hash) between 1 and 128),
  row_count integer not null check (row_count >= 0),
  format_version integer not null check (format_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, tab_key)
);
create trigger sheet_tabs_set_updated_at before update on public.sheet_tabs
  for each row execute function private.set_updated_at();

create table public.sheet_dirty_years (
  workspace_id uuid not null references public.sheet_syncs (workspace_id) on delete cascade,
  year integer not null,
  version bigint not null default 1,
  changed_at timestamptz not null default now(),
  first_changed_at timestamptz not null default now(),
  primary key (workspace_id, year)
);

alter table public.sheet_syncs enable row level security;
alter table public.sheet_tabs enable row level security;
alter table public.sheet_dirty_years enable row level security;
revoke all on table public.sheet_syncs, public.sheet_tabs, public.sheet_dirty_years from anon, authenticated;
-- Members read the state and tab ids (links); the account, the file tag and the lease stay hidden.
grant select (workspace_id, spreadsheet_id, status, paused_reason, synced_at, created_at)
  on table public.sheet_syncs to authenticated;
grant select (workspace_id, tab_key, year, google_sheet_id, title, starts_from, starts_to)
  on table public.sheet_tabs to authenticated;
grant all on table public.sheet_syncs, public.sheet_tabs, public.sheet_dirty_years to service_role;
create policy sheet_syncs_select_member on public.sheet_syncs
  for select to authenticated using (private.is_member(workspace_id));
create policy sheet_tabs_select_member on public.sheet_tabs
  for select to authenticated using (private.is_member(workspace_id));

-- The year tab a meeting belongs to: its start's year in its own zone. Twin: sheetYear
-- (src/lib/sheets/year.ts).
create function private.sheet_year(p_starts_at timestamptz, p_timezone text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select extract(year from (p_starts_at at time zone p_timezone))::integer
$$;

-- The only writer of sheet_dirty_years: marks (workspace, year) pairs as changed, for workspaces
-- that have a sheet (one index probe otherwise). A new change raises the version, so a write that
-- read an older version leaves the year marked (spec §8).
create function private.sheet_mark(p_workspaces uuid[], p_years integer[])
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.sheet_dirty_years as d (workspace_id, year)
  select distinct y.workspace_id, y.year
  from rows from (pg_catalog.unnest(p_workspaces), pg_catalog.unnest(p_years)) as y(workspace_id, year)
  where y.year is not null
    and exists (select 1 from public.sheet_syncs s where s.workspace_id = y.workspace_id)
  on conflict (workspace_id, year) do update
    set version = d.version + 1, changed_at = pg_catalog.now()
$$;

-- Workspace-wide changes (its name, a list's name): every year that has a tab, plus this year.
create function private.sheet_mark_all(p_workspaces uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  select private.sheet_mark(pg_catalog.array_agg(y.workspace_id), pg_catalog.array_agg(y.year))
  from (
    select t.workspace_id, t.year from public.sheet_tabs t where t.workspace_id = any (p_workspaces)
    union
    select w.id, private.sheet_year(pg_catalog.now(), w.timezone)
    from public.workspaces w where w.id = any (p_workspaces)
  ) y
$$;

-- A connection is in use while a workspace sends from it or a sheet lives in it (spec §9).
create function private.connection_in_use(p_connection uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.workspaces w where w.sender_connection_id = p_connection)
    or exists (select 1 from public.sheet_syncs s where s.connection_id = p_connection)
$$;

-- The only place a Google connection is deleted: when nothing uses it any more. Returns what the
-- route needs to revoke the token at Google (null when kept or already gone).
create function private.release_connection(p_connection uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_released jsonb;
begin
  if p_connection is null or private.connection_in_use(p_connection) then
    return null;
  end if;
  delete from public.google_connections c
  where c.id = p_connection
  returning pg_catalog.jsonb_build_object(
    'refresh_token_encrypted', c.refresh_token_encrypted, 'google_sub', c.google_sub, 'user_id', c.user_id)
  into v_released;
  return v_released;
end;
$$;

-- save_google_connection: latest body from 20261007174925_m4_save_connection_service_role.sql; a
-- connection exists for sending (gmail.send) or for a sheet (drive.file).
create or replace function private.save_google_connection(
  p_user uuid,
  p_google_sub text,
  p_google_email text,
  p_scopes text[],
  p_token_encrypted text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_user is null or not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if not (coalesce(p_scopes, '{}') && array['https://www.googleapis.com/auth/gmail.send',
                                             'https://www.googleapis.com/auth/drive.file']) then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  insert into public.google_connections (user_id, google_sub, google_email, granted_scopes, refresh_token_encrypted)
  values (p_user, p_google_sub, lower(btrim(p_google_email)), p_scopes, p_token_encrypted)
  on conflict (user_id, google_sub) do update set
    google_email = excluded.google_email,
    granted_scopes = excluded.granted_scopes,
    refresh_token_encrypted = excluded.refresh_token_encrypted,
    status = 'active',
    broken_reason = null,
    broken_at = null
  returning id into v_id;
  return v_id;
end;
$$;

-- disconnect_google_connection: was "delete my connection"; now "stop sending from it" everywhere
-- and release it unless a sheet lives in it (spec §9). Returns what to revoke and which sheets keep it.
drop function public.disconnect_google_connection(uuid);
drop function private.disconnect_google_connection(uuid);
create function private.disconnect_google_connection(p_connection uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.google_connections c where c.id = p_connection and c.user_id = auth.uid()
  ) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  update public.workspaces set sender_connection_id = null where sender_connection_id = p_connection;
  return pg_catalog.jsonb_build_object(
    'released', private.release_connection(p_connection),
    'sheets_kept', coalesce((
      select pg_catalog.jsonb_agg(w.name order by w.name)
      from public.sheet_syncs s join public.workspaces w on w.id = s.workspace_id
      where s.connection_id = p_connection
    ), '[]'::jsonb)
  );
end;
$$;
create function public.disconnect_google_connection(p_connection uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.disconnect_google_connection(p_connection) $$;

-- workspace_sender: latest body from 20261007173708_m4_sender.sql; each of my connections also
-- names the workspaces whose Google Sheet lives in it (Sending Disconnect wording, spec §7.15).
create or replace function private.workspace_sender(p_workspace uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if not private.is_member(p_workspace) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  return pg_catalog.jsonb_build_object(
    'sender', (
      select pg_catalog.jsonb_build_object(
        'connection_id', c.id,
        'email', c.google_email,
        'status', c.status,
        'connected_by', coalesce(p.display_name, ''),
        'connected_at', c.updated_at,
        'is_mine', c.user_id = v_user,
        'sent_last_24h', (
          select count(*) from public.send_log s
          where s.google_sub = c.google_sub and s.sent_at > pg_catalog.now() - interval '24 hours'
        ),
        'daily_limit', private.app_limit('gmail_sends_per_day')
      )
      from public.workspaces w
      join public.google_connections c on c.id = w.sender_connection_id
      left join public.profiles p on p.user_id = c.user_id
      where w.id = p_workspace
    ),
    'owner_name', coalesce((
      select p.display_name from public.workspace_roles r
      left join public.profiles p on p.user_id = r.user_id
      where r.workspace_id = p_workspace and r.role = 'owner'
    ), ''),
    'my_connections', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', c.id,
          'email', c.google_email,
          'status', c.status,
          'used_by', coalesce((
            select pg_catalog.jsonb_agg(w.name order by w.name)
            from public.workspaces w where w.sender_connection_id = c.id
          ), '[]'::jsonb),
          'sheets', coalesce((
            select pg_catalog.jsonb_agg(w.name order by w.name)
            from public.sheet_syncs s join public.workspaces w on w.id = s.workspace_id
            where s.connection_id = c.id
          ), '[]'::jsonb)
        )
        order by c.google_email
      )
      from public.google_connections c
      where c.user_id = v_user
    ), '[]'::jsonb)
  );
end;
$$;

-- delete_workspace: body from 20261006081823_m2_membership.sql (moved to private by
-- 20261006224354_m3_definer_wrappers.sql); it now releases the workspace's Google accounts that
-- nothing else uses and returns them for revocation. The return type changes, so drop + create.
drop function public.delete_workspace(uuid, text);
drop function private.delete_workspace(uuid, text);
create function private.delete_workspace(p_workspace uuid, p_confirm_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_connections uuid[];
begin
  if private.role_of(p_workspace) is distinct from 'owner' then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  select w.name into v_name from public.workspaces w where w.id = p_workspace for update;
  if btrim(coalesce(p_confirm_name, '')) <> v_name then
    raise exception 'tn:name_mismatch' using errcode = 'P0001';
  end if;
  select pg_catalog.array_agg(distinct x.id) into v_connections
  from (
    select w.sender_connection_id as id from public.workspaces w where w.id = p_workspace
    union select s.connection_id from public.sheet_syncs s where s.workspace_id = p_workspace
  ) x
  where x.id is not null;
  delete from public.workspaces where id = p_workspace;
  -- Accounts nothing else uses are released; the synced Google Sheet stays in Drive (spec §7.11).
  return pg_catalog.jsonb_build_object('released', coalesce((
    select pg_catalog.jsonb_agg(r.released) from (
      select private.release_connection(c) as released from pg_catalog.unnest(v_connections) as c
    ) r where r.released is not null
  ), '[]'::jsonb));
end;
$$;
create function public.delete_workspace(p_workspace uuid, p_confirm_name text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.delete_workspace(p_workspace, p_confirm_name) $$;

-- What Settings > Sheets shows (any member); the account email to the Owner only (spec §7.17).
create function private.workspace_sheet(p_workspace uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.workspace_role := private.role_of(p_workspace);
begin
  if v_role is null then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  return (
    select pg_catalog.jsonb_build_object(
      'state', case when s.workspace_id is null then 'off' when s.status = 'paused' then 'paused'
                    when s.spreadsheet_id is null then 'creating' else 'on' end,
      'spreadsheet_id', s.spreadsheet_id,
      'paused_reason', s.paused_reason,
      'synced_at', s.synced_at,
      'behind', exists (select 1 from public.sheet_dirty_years d where d.workspace_id = p_workspace),
      'created_at', s.created_at,
      'turned_on_by', coalesce(p.display_name, ''),
      'account_email', case when v_role = 'owner' then s.google_email end,
      'owner_name', coalesce((
        select op.display_name from public.workspace_roles r
        left join public.profiles op on op.user_id = r.user_id
        where r.workspace_id = p_workspace and r.role = 'owner'), ''),
      'tabs', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'year', t.year, 'google_sheet_id', t.google_sheet_id,
          'starts_from', t.starts_from, 'starts_to', t.starts_to)
          order by t.year desc, t.starts_to desc nulls last)
        from public.sheet_tabs t where t.workspace_id = p_workspace), '[]'::jsonb)
    )
    from (select 1) as one
    left join public.sheet_syncs s on s.workspace_id = p_workspace
    left join public.profiles p on p.user_id = s.created_by
  );
end;
$$;

create function private.require_owner(p_workspace uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.role_of(p_workspace) is distinct from 'owner' then
    if private.is_member(p_workspace) then
      raise exception 'tn:owner_only' using errcode = 'P0001';
    end if;
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
end;
$$;

-- Turn off (Owner): the sheet stops updating, the file stays in Drive, the account is released when
-- nothing else uses it.
create function private.turn_off_sheet(p_workspace uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_connection uuid;
begin
  perform private.require_owner(p_workspace);
  delete from public.sheet_syncs where workspace_id = p_workspace returning connection_id into v_connection;
  if not found then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  return pg_catalog.jsonb_build_object('released', private.release_connection(v_connection));
end;
$$;

-- Try again (Owner, rate limited): redraw now; a sheet paused because its file was trashed resumes
-- (the worker pauses it again if the file is still in the trash).
create function private.retry_sheet(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sheet public.sheet_syncs;
begin
  perform private.require_owner(p_workspace);
  select * into v_sheet from public.sheet_syncs where workspace_id = p_workspace for update;
  if v_sheet.workspace_id is null then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if v_sheet.status = 'paused' and v_sheet.paused_reason <> 'trashed' then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if not private.hit_user_rate_limit('sheet_retry') then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;
  update public.sheet_syncs
  set status = 'active', paused_reason = null, paused_at = null, retry_at = pg_catalog.now(), attempts = 0
  where workspace_id = p_workspace;
  perform private.sheet_mark(array[p_workspace],
    array[(select private.sheet_year(pg_catalog.now(), w.timezone) from public.workspaces w where w.id = p_workspace)]);
end;
$$;

-- The connect callback (service role): turn the sheet on, reattach it after "Reconnect Google", or
-- replace it ("Create a new sheet"). A new sheet starts with every year that has answers marked.
create function private.start_sheet(p_user uuid, p_workspace uuid, p_connection uuid, p_replace boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conn public.google_connections;
  v_sheet public.sheet_syncs;
begin
  if not exists (
    select 1 from public.workspace_roles r
    where r.workspace_id = p_workspace and r.user_id = p_user and r.role = 'owner'
  ) then
    raise exception 'tn:owner_only' using errcode = 'P0001';
  end if;
  select * into v_conn from public.google_connections c where c.id = p_connection and c.user_id = p_user;
  if v_conn.id is null or not ('https://www.googleapis.com/auth/drive.file' = any (v_conn.granted_scopes)) then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  select * into v_sheet from public.sheet_syncs s where s.workspace_id = p_workspace for update;
  if v_sheet.workspace_id is not null and not coalesce(p_replace, false) then
    if v_sheet.google_sub <> v_conn.google_sub then
      raise exception 'tn:sheet_wrong_account' using errcode = 'P0001';
    end if;
    update public.sheet_syncs
    set connection_id = v_conn.id, google_email = v_conn.google_email, retry_at = pg_catalog.now(), attempts = 0,
      status = case when paused_reason = 'access_lost' then 'active'::public.sheet_status else status end,
      paused_at = case when paused_reason = 'access_lost' then null else paused_at end,
      paused_reason = case when paused_reason = 'access_lost' then null else paused_reason end
    where workspace_id = p_workspace;
    perform private.sheet_mark_all(array[p_workspace]);
    return pg_catalog.jsonb_build_object('started', false, 'released', null);
  end if;
  delete from public.sheet_syncs where workspace_id = p_workspace;
  insert into public.sheet_syncs (workspace_id, connection_id, google_sub, google_email, created_by)
  values (p_workspace, v_conn.id, v_conn.google_sub, v_conn.google_email, p_user);
  perform private.sheet_mark(pg_catalog.array_agg(y.workspace_id), pg_catalog.array_agg(y.year))
  from (
    select distinct m.workspace_id, private.sheet_year(m.starts_at, m.timezone) as year
    from public.meetings m
    where m.workspace_id = p_workspace and m.status in ('scheduled', 'cancelled')
      and m.response_mode <> 'announcement' and m.starts_at is not null
    union
    select w.id, private.sheet_year(pg_catalog.now(), w.timezone) from public.workspaces w where w.id = p_workspace
  ) y;
  return pg_catalog.jsonb_build_object(
    'started', true,
    'released', case when v_sheet.connection_id is distinct from v_conn.id
                     then private.release_connection(v_sheet.connection_id) end);
end;
$$;

-- After any successful Google callback (service role): with drive.file, this user's sheets on the
-- same Google account move to this connection (an access-lost one resumes); without it, active
-- sheets on this connection pause (spec §8 Resume).
create function private.google_connection_saved(p_user uuid, p_connection uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conn public.google_connections;
  v_workspaces uuid[];
begin
  select * into v_conn from public.google_connections c where c.id = p_connection and c.user_id = p_user;
  if v_conn.id is null then
    return;
  end if;
  if 'https://www.googleapis.com/auth/drive.file' = any (v_conn.granted_scopes) then
    with moved as (
      update public.sheet_syncs s
      set connection_id = v_conn.id, google_email = v_conn.google_email, status = 'active', paused_reason = null,
        paused_at = null, retry_at = pg_catalog.now(), attempts = 0
      where s.google_sub = v_conn.google_sub
        and (s.status = 'active' or s.paused_reason = 'access_lost')
        and (s.connection_id is distinct from v_conn.id or s.status = 'paused')
        and exists (select 1 from public.workspace_roles r
                    where r.workspace_id = s.workspace_id and r.user_id = p_user and r.role = 'owner')
      returning s.workspace_id
    )
    select pg_catalog.array_agg(moved.workspace_id) into v_workspaces from moved;
    if v_workspaces is not null then
      perform private.sheet_mark_all(v_workspaces);
    end if;
  else
    update public.sheet_syncs
    set status = 'paused', paused_reason = 'access_lost', paused_at = pg_catalog.now()
    where connection_id = v_conn.id and status = 'active';
  end if;
end;
$$;

-- hit_user_rate_limit: latest body from 20261009235635_m6_edit_cancel.sql, plus Try again and the
-- Google connect route.
create or replace function private.hit_user_rate_limit(p_action text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_limit_name text := case p_action
    when 'import' then 'imports_per_user_per_hour'
    when 'import_preview' then 'import_previews_per_user_per_hour'
    when 'contact_add' then 'contact_adds_per_user_per_hour'
    when 'meeting_create' then 'meetings_per_user_per_hour'
    when 'meeting_people_add' then 'meeting_people_adds_per_user_per_hour'
    when 'meeting_edit_email' then 'meeting_email_edits_per_user_per_hour'
    when 'sheet_retry' then 'sheet_retries_per_user_per_hour'
    when 'google_connect' then 'google_connects_per_user_per_hour'
  end;
begin
  if v_user is null or v_limit_name is null then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return private.hit_rate_limit(p_action || ':user:' || v_user::text, private.app_limit(v_limit_name), interval '1 hour');
end;
$$;

create function public.hit_google_connect_limit() returns boolean language sql security invoker set search_path = '' as $$ select private.hit_user_rate_limit('google_connect') $$;

create function public.workspace_sheet(p_workspace uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.workspace_sheet(p_workspace) $$;
create function public.turn_off_sheet(p_workspace uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.turn_off_sheet(p_workspace) $$;
create function public.retry_sheet(p_workspace uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.retry_sheet(p_workspace) $$;
create function public.start_sheet(p_user uuid, p_workspace uuid, p_connection uuid, p_replace boolean)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.start_sheet(p_user, p_workspace, p_connection, p_replace) $$;
create function public.google_connection_saved(p_user uuid, p_connection uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.google_connection_saved(p_user, p_connection) $$;

revoke execute on function
  private.sheet_year(timestamptz, text), private.sheet_mark(uuid[], integer[]), private.sheet_mark_all(uuid[]),
  private.connection_in_use(uuid), private.release_connection(uuid), private.require_owner(uuid),
  private.start_sheet(uuid, uuid, uuid, boolean), private.google_connection_saved(uuid, uuid)
from public, anon, authenticated;
grant execute on function
  private.workspace_sheet(uuid), private.turn_off_sheet(uuid), private.retry_sheet(uuid),
  private.disconnect_google_connection(uuid), private.delete_workspace(uuid, text)
to authenticated;
revoke execute on function private.workspace_sheet(uuid), private.turn_off_sheet(uuid), private.retry_sheet(uuid),
  private.disconnect_google_connection(uuid), private.delete_workspace(uuid, text) from public, anon;
grant execute on function private.start_sheet(uuid, uuid, uuid, boolean), private.google_connection_saved(uuid, uuid) to service_role;
revoke execute on function public.workspace_sheet(uuid), public.turn_off_sheet(uuid), public.retry_sheet(uuid),
  public.disconnect_google_connection(uuid), public.delete_workspace(uuid, text), public.hit_google_connect_limit(),
  public.start_sheet(uuid, uuid, uuid, boolean), public.google_connection_saved(uuid, uuid)
from public, anon;
grant execute on function public.workspace_sheet(uuid), public.turn_off_sheet(uuid), public.retry_sheet(uuid),
  public.disconnect_google_connection(uuid), public.delete_workspace(uuid, text), public.hit_google_connect_limit()
to authenticated;
revoke execute on function public.start_sheet(uuid, uuid, uuid, boolean), public.google_connection_saved(uuid, uuid) from authenticated;
grant execute on function public.start_sheet(uuid, uuid, uuid, boolean), public.google_connection_saved(uuid, uuid) to service_role;
