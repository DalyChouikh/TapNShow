-- #413 (docs/superpowers/specs/2026-10-20-sheet-team-sharing-design.md §5): the share worker's
-- calls, and removing the access TapNShow gave before it lets go of its Google access.
-- Latest bodies: connection_in_use from 20261011091257_m7_sheet_state.sql, delete_workspace from
-- 20261011091257_m7_sheet_state.sql, delete_account from 20261015092518_m8_minors.sql, sheet_pause
-- from 20261014151133_m8_account_deletion.sql, workers_due from 20261020203846_sheet_team_sharing.sql.

-- The wake-up (every minute) and the share claim find due shares through this index, like
-- sheet_syncs_due_idx serves the redraws.
create index sheet_syncs_shares_due_idx on public.sheet_syncs (shares_due_at) where shares_due_at is not null;

-- Backoff of a sheet's share step after a Google error (same shape as the redraw's).
alter table public.sheet_syncs add column shares_attempts integer not null default 0 check (shares_attempts >= 0);

-- How long a cleanup keeps trying before it revokes anyway and tells the Owner (design §5).
insert into private.app_limits (name, value) values ('sheet_share_cleanup_max_hours', 24);

-- Access to remove from a file TapNShow is letting go of. No foreign key to the workspace or the
-- sheet: it outlives both. It keeps its own sealed token copy (the connection can be deleted with
-- an account) until the removal is done, then the row and the copy go together.
create table public.sheet_share_cleanups (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  workspace_name text,
  owner_user_id uuid references auth.users (id) on delete set null,
  spreadsheet_id text not null check (spreadsheet_id ~ '^[A-Za-z0-9_-]{10,200}$'),
  google_email text not null,
  connection_id uuid references public.google_connections (id) on delete set null,
  google_sub text not null,
  token_user_id uuid not null,
  refresh_token_encrypted text not null,
  permission_ids text[] not null default '{}',
  emails text[] not null default '{}',
  revoke_after boolean not null,
  attempts integer not null default 0 check (attempts >= 0),
  retry_at timestamptz not null default now(),
  give_up_at timestamptz not null,
  run_id uuid,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);
create index sheet_share_cleanups_retry_idx on public.sheet_share_cleanups (retry_at);
create index sheet_share_cleanups_workspace_idx on public.sheet_share_cleanups (workspace_id);
create index sheet_share_cleanups_connection_idx on public.sheet_share_cleanups (connection_id);
create index sheet_share_cleanups_owner_idx on public.sheet_share_cleanups (owner_user_id);
alter table public.sheet_share_cleanups enable row level security;
revoke all on table public.sheet_share_cleanups from anon, authenticated;
grant all on table public.sheet_share_cleanups to service_role;

-- Keeps the access TapNShow gave on a workspace's file to remove (its own shares, and addresses
-- whose share Google may have made before the run recorded it), then forgets them on the sheet so
-- a later reconnect shares again. p_revoke: the connection is going (account deletion), so the
-- cleanup revokes the token when it is done.
create function private.sheet_shares_retire(p_workspace uuid, p_revoke boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sheet public.sheet_syncs;
  v_conn public.google_connections;
  v_ids text[];
  v_emails text[];
begin
  select * into v_sheet from public.sheet_syncs s where s.workspace_id = p_workspace;
  if v_sheet.workspace_id is null or v_sheet.spreadsheet_id is null or v_sheet.connection_id is null then
    return;
  end if;
  select * into v_conn from public.google_connections c where c.id = v_sheet.connection_id;
  if v_conn.id is null then
    return;
  end if;
  select coalesce(pg_catalog.array_agg(sh.permission_id) filter (where sh.state = 'shared' and sh.permission_id is not null), '{}'),
    coalesce(pg_catalog.array_agg(sh.email) filter (where sh.state = 'sharing'), '{}')
  into v_ids, v_emails
  from public.sheet_shares sh
  where sh.workspace_id = p_workspace and sh.state in ('shared', 'sharing');
  if pg_catalog.cardinality(v_ids) = 0 and pg_catalog.cardinality(v_emails) = 0 then
    return;
  end if;
  insert into public.sheet_share_cleanups (
    workspace_id, workspace_name, owner_user_id, spreadsheet_id, google_email, connection_id, google_sub,
    token_user_id, refresh_token_encrypted, permission_ids, emails, revoke_after, give_up_at)
  values (
    p_workspace,
    (select w.name from public.workspaces w where w.id = p_workspace),
    (select r.user_id from public.workspace_roles r where r.workspace_id = p_workspace and r.role = 'owner'),
    v_sheet.spreadsheet_id, v_sheet.google_email, v_conn.id, v_conn.google_sub, v_conn.user_id,
    v_conn.refresh_token_encrypted, v_ids, v_emails, p_revoke,
    pg_catalog.now() + pg_catalog.make_interval(hours => private.app_limit('sheet_share_cleanup_max_hours')));
  update public.sheet_shares sh
  set state = 'pending', permission_id = null, reason = null, next_try_at = null, updated_at = pg_catalog.now()
  where sh.workspace_id = p_workspace and sh.state in ('shared', 'sharing');
end;
$$;

-- Turning the sheet off and replacing it delete the sheet row: its shares are kept to remove first.
create function private.sheet_syncs_retire()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sheet_shares_retire(old.workspace_id, false);
  return old;
end;
$$;
create trigger sheet_syncs_retire before delete on public.sheet_syncs
  for each row execute function private.sheet_syncs_retire();

-- A connection a cleanup still needs is in use: release_connection keeps it until the cleanup ends.
create or replace function private.connection_in_use(p_connection uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.workspaces w where w.sender_connection_id = p_connection)
    or exists (select 1 from public.sheet_syncs s where s.connection_id = p_connection)
    or exists (select 1 from public.sheet_share_cleanups k where k.connection_id = p_connection)
$$;

create or replace function private.delete_workspace(p_workspace uuid, p_confirm_name text)
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
  -- While the workspace's name is still visible: the access TapNShow gave to the team is kept to
  -- remove, and the sheet's Google account stays held until it is (#413).
  perform private.sheet_shares_retire(p_workspace, false);
  delete from public.workspaces where id = p_workspace;
  -- Accounts nothing else uses are released; the synced Google Sheet stays in Drive (spec §7.11).
  return pg_catalog.jsonb_build_object('released', coalesce((
    select pg_catalog.jsonb_agg(r.released) from (
      select private.release_connection(c, auth.uid()) as released from pg_catalog.unnest(v_connections) as c
    ) r where r.released is not null
  ), '[]'::jsonb));
end;
$$;

create or replace function private.delete_account(p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_connections uuid[];
  v_senders uuid[];
  v_sheets uuid[];
  v_workspace uuid;
  v_alerts jsonb := '[]'::jsonb;
  v_target jsonb;
  v_kind text;
begin
  if v_user is null then
    raise exception 'tn:unauthenticated' using errcode = 'P0001';
  end if;
  if p_confirm is distinct from 'confirm' then
    raise exception 'tn:name_mismatch' using errcode = 'P0001';
  end if;
  if not private.hit_user_rate_limit('account_delete') then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;
  -- Lock the person's seats first: an ownership transfer to them (which needs an existing Admin
  -- seat) waits, then finds no seat.
  perform 1 from public.workspace_roles r where r.user_id = v_user for update;
  if exists (select 1 from public.workspace_roles r where r.user_id = v_user and r.role = 'owner') then
    raise exception 'tn:owns_workspaces' using errcode = 'P0001';
  end if;
  delete from public.workspace_roles r where r.user_id = v_user;

  -- Reasons and comments go everywhere; statuses and check-ins stay for the groups (the sheet
  -- triggers mark the years, so the Google Sheet drops the words at its next redraw).
  update public.responses r set reason = '', comment = ''
  where r.invitee_id in (
      select i.id from public.meeting_invitees i where i.contact_id in (select private.contacts_of(v_user)))
    and (r.reason <> '' or r.comment <> '');
  update public.response_history h set reason = '', comment = ''
  where h.invitee_id in (
      select i.id from public.meeting_invitees i where i.contact_id in (select private.contacts_of(v_user)))
    and (h.reason <> '' or h.comment <> '');

  select coalesce(pg_catalog.array_agg(c.id), '{}') into v_connections
  from public.google_connections c where c.user_id = v_user;

  with stopped as (
    update public.workspaces w set sender_connection_id = null
    where w.sender_connection_id = any (v_connections)
    returning w.id
  )
  select coalesce(pg_catalog.array_agg(s.id), '{}') into v_senders from stopped s;

  -- The team's access TapNShow gave on a sheet held by this person's Google account is removed
  -- before the account goes; the cleanup keeps its own token copy and revokes it after (#413).
  perform private.sheet_shares_retire(s.workspace_id, true)
  from public.sheet_syncs s where s.connection_id = any (v_connections);

  -- The sheet keeps its account (google_sub/email) for "Pick that account"; only the link goes.
  with paused as (
    update public.sheet_syncs s
    set status = 'paused', paused_reason = 'access_lost', paused_at = pg_catalog.now(),
      run_id = null, locked_until = null, connection_id = null
    where s.connection_id = any (v_connections)
    returning s.workspace_id
  )
  select coalesce(pg_catalog.array_agg(p.workspace_id), '{}') into v_sheets from paused p;

  for v_workspace in
    select distinct x.id from pg_catalog.unnest(v_senders || v_sheets) as x(id)
  loop
    v_target := null;
    if v_workspace = any (v_sheets) then
      v_target := private.sheet_alert_target(v_workspace);
      v_kind := case when v_workspace = any (v_senders) then 'both' else 'sheet' end;
    end if;
    if v_target is null and v_workspace = any (v_senders) then
      v_target := private.owner_alert_target(v_workspace);
      v_kind := 'sender';
    end if;
    if v_target is not null then
      v_alerts := v_alerts || pg_catalog.jsonb_build_array(v_target || pg_catalog.jsonb_build_object('kind', v_kind));
    end if;
  end loop;

  -- Nothing uses them now; release_connection keeps the token when another person's connection
  -- holds the same Google account (spec §9, M7 final review).
  return pg_catalog.jsonb_build_object(
    'released', coalesce((
      select pg_catalog.jsonb_agg(x.released)
      from (select private.release_connection(c, v_user) as released from pg_catalog.unnest(v_connections) as c) x
      where x.released is not null), '[]'::jsonb),
    'alerts', v_alerts
  );
end;
$$;

-- One pause, shared by the redraw and the share step (each checks its own lease first).
create function private.sheet_pause_apply(p_workspace uuid, p_reason public.sheet_pause_reason)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.sheet_syncs
  set status = 'paused', paused_reason = p_reason, paused_at = pg_catalog.now(),
    run_id = null, locked_until = null, shares_run_id = null, shares_locked_until = null
  where workspace_id = p_workspace;
  return private.sheet_alert_target(p_workspace) || pg_catalog.jsonb_build_object('reason', p_reason);
end;
$$;

create or replace function private.sheet_pause(p_workspace uuid, p_run uuid, p_reason public.sheet_pause_reason)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.sheet_syncs s where s.workspace_id = p_workspace and s.run_id = p_run) then
    return null;
  end if;
  return private.sheet_pause_apply(p_workspace, p_reason);
end;
$$;

create function private.sheet_share_pause(p_workspace uuid, p_run uuid, p_reason public.sheet_pause_reason)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.sheet_syncs s where s.workspace_id = p_workspace and s.shares_run_id = p_run) then
    return null;
  end if;
  return private.sheet_pause_apply(p_workspace, p_reason);
end;
$$;
create function public.sheet_share_pause(p_workspace uuid, p_run uuid, p_reason public.sheet_pause_reason)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.sheet_share_pause(p_workspace, p_run, p_reason) $$;

-- Leases due sheets to one share run and hands it the wanted team and TapNShow's records.
create function public.sheet_share_claim(p_run uuid, p_limit integer, p_lease_seconds integer)
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
    where s.shares_due_at <= pg_catalog.now() and private.sheet_shares_due(s)
    order by s.shares_due_at
    limit p_limit
    for update of s skip locked
  ), leased as (
    update public.sheet_syncs s
    set shares_run_id = p_run, shares_locked_until = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds)
    from picked where s.workspace_id = picked.workspace_id
    returning s.*
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'workspace_id', l.workspace_id, 'spreadsheet_id', l.spreadsheet_id, 'version', l.shares_version,
    'cap', private.app_limit('sheet_team_shares_max'),
    'connection', case when c.id is null then null else pg_catalog.jsonb_build_object(
      'id', c.id, 'user_id', c.user_id, 'google_sub', c.google_sub,
      'refresh_token_encrypted', c.refresh_token_encrypted, 'granted_scopes', c.granted_scopes) end,
    'targets', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('user_id', t.user_id, 'email', t.email, 'position', t."position")
        order by t."position")
      from private.sheet_share_targets(l.workspace_id) t), '[]'::jsonb),
    'shares', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'email', sh.email, 'state', sh.state, 'permission_id', sh.permission_id, 'reason', sh.reason,
        'next_try_at', sh.next_try_at) order by sh.email)
      from public.sheet_shares sh where sh.workspace_id = l.workspace_id), '[]'::jsonb)
  )), '[]'::jsonb)
  into v_rows
  from leased l
  left join public.google_connections c on c.id = l.connection_id;
  return v_rows;
end;
$$;

-- True while p_run holds the sheet's shares lease (every share write checks it).
create function private.sheet_shares_leased(p_workspace uuid, p_run uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.sheet_syncs s
    where s.workspace_id = p_workspace and s.shares_run_id = p_run and s.shares_locked_until > pg_catalog.now())
$$;

-- The intent, written before permissions.create: a crash between Google and the database is then
-- recovered by adopting the listed permission, never by sharing again (design §4 spike).
create function public.sheet_share_intend(p_workspace uuid, p_run uuid, p_email text, p_user uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.sheet_shares_leased(p_workspace, p_run) then
    return false;
  end if;
  insert into public.sheet_shares as sh (workspace_id, user_id, email, state)
  values (p_workspace, p_user, pg_catalog.lower(p_email), 'sharing')
  on conflict (workspace_id, email) do update
    set user_id = excluded.user_id, state = 'sharing', permission_id = null, reason = null, next_try_at = null,
      updated_at = pg_catalog.now();
  return true;
end;
$$;

create function public.sheet_share_save(
  p_workspace uuid, p_run uuid, p_email text, p_user uuid, p_state public.sheet_share_state,
  p_permission_id text, p_reason public.sheet_share_reason, p_next_try_at timestamptz
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.sheet_shares_leased(p_workspace, p_run) then
    return false;
  end if;
  insert into public.sheet_shares as sh (workspace_id, user_id, email, state, permission_id, reason, next_try_at)
  values (p_workspace, p_user, pg_catalog.lower(p_email), p_state, p_permission_id, p_reason, p_next_try_at)
  on conflict (workspace_id, email) do update
    set user_id = excluded.user_id, state = excluded.state, permission_id = excluded.permission_id,
      reason = excluded.reason, next_try_at = excluded.next_try_at, updated_at = pg_catalog.now();
  return true;
end;
$$;

create function public.sheet_share_forget(p_workspace uuid, p_run uuid, p_emails text[])
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.sheet_shares_leased(p_workspace, p_run) then
    return false;
  end if;
  delete from public.sheet_shares sh
  where sh.workspace_id = p_workspace
    and sh.email = any (array(select pg_catalog.lower(e) from pg_catalog.unnest(p_emails) as e));
  return true;
end;
$$;

-- Ends a share run: the mark is cleared (or moved to p_next_due) only when no change came since the
-- claim; a newer mark keeps the sheet due now.
create function public.sheet_share_release(p_workspace uuid, p_run uuid, p_version bigint, p_next_due timestamptz)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.sheet_syncs
  set shares_run_id = null, shares_locked_until = null, shares_attempts = 0,
    shares_due_at = case when shares_version = p_version then p_next_due
                         else least(coalesce(shares_due_at, pg_catalog.now()), pg_catalog.now()) end
  where workspace_id = p_workspace and shares_run_id = p_run
$$;

-- A Google error on the share step: try the sheet's shares again later (the redraw is unaffected).
create function public.sheet_share_retry(p_workspace uuid, p_run uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.sheet_syncs
  set shares_attempts = shares_attempts + 1, shares_run_id = null, shares_locked_until = null,
    shares_due_at = pg_catalog.now()
      + pg_catalog.make_interval(mins => least(private.app_limit('sheet_retry_max_minutes'), (2 ^ least(shares_attempts, 10))::integer))
      + pg_catalog.make_interval(secs => pg_catalog.random() * 30)
  where workspace_id = p_workspace and shares_run_id = p_run
$$;

-- Cleanups: one run at a time, backoff on a Google error, and the end (release, revoke, alert).
create function public.sheet_share_cleanup_claim(p_run uuid, p_limit integer, p_lease_seconds integer)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  with picked as (
    select k.id from public.sheet_share_cleanups k
    where k.retry_at <= pg_catalog.now() and (k.locked_until is null or k.locked_until < pg_catalog.now())
    order by k.retry_at
    limit p_limit
    for update skip locked
  ), leased as (
    update public.sheet_share_cleanups k
    set run_id = p_run, locked_until = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds)
    from picked where k.id = picked.id
    returning k.*
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id', l.id, 'spreadsheet_id', l.spreadsheet_id, 'google_sub', l.google_sub, 'token_user_id', l.token_user_id,
    'refresh_token_encrypted', l.refresh_token_encrypted, 'permission_ids', l.permission_ids, 'emails', l.emails,
    'give_up_at', l.give_up_at)), '[]'::jsonb)
  into v_rows
  from leased l;
  return v_rows;
end;
$$;

create function public.sheet_share_cleanup_retry(p_id uuid, p_run uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.sheet_share_cleanups
  set attempts = attempts + 1, run_id = null, locked_until = null,
    retry_at = pg_catalog.now()
      + pg_catalog.make_interval(mins => least(private.app_limit('sheet_retry_max_minutes'), (2 ^ least(attempts, 10))::integer))
      + pg_catalog.make_interval(secs => pg_catalog.random() * 30)
  where id = p_id and run_id = p_run
$$;

-- Ends a cleanup: the row and its token copy go; the held connection is released (and returned for
-- revoking) when nothing uses it, or the copy itself is returned when the connection is gone and the
-- account is being deleted; the Owner is told how many people may still have access.
create function private.sheet_share_cleanup_finish(p_id uuid, p_run uuid, p_left integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.sheet_share_cleanups;
  v_released jsonb;
  v_alert jsonb;
begin
  delete from public.sheet_share_cleanups k where k.id = p_id and k.run_id = p_run returning k.* into v_row;
  if v_row.id is null then
    return null;
  end if;
  if v_row.connection_id is not null then
    v_released := private.release_connection(v_row.connection_id, v_row.token_user_id);
  elsif v_row.revoke_after
    and not exists (select 1 from public.google_connections o where o.google_sub = v_row.google_sub) then
    v_released := pg_catalog.jsonb_build_object(
      'refresh_token_encrypted', v_row.refresh_token_encrypted, 'google_sub', v_row.google_sub,
      'user_id', v_row.token_user_id);
  end if;
  if p_left > 0 then
    select pg_catalog.jsonb_build_object(
      'email', u.email, 'workspace_name', v_row.workspace_name, 'spreadsheet_id', v_row.spreadsheet_id,
      'account_email', v_row.google_email, 'left', p_left)
    into v_alert
    from auth.users u where u.id = v_row.owner_user_id;
  end if;
  return pg_catalog.jsonb_build_object('released', v_released, 'alert', v_alert);
end;
$$;
create function public.sheet_share_cleanup_finish(p_id uuid, p_run uuid, p_left integer)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.sheet_share_cleanup_finish(p_id, p_run, p_left) $$;

create or replace function private.workers_due()
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
    or exists (
      select 1 from public.sheet_syncs s
      where s.status = 'active' and s.retry_at <= pg_catalog.now() and private.sheet_due(s))
    -- A sheet's shares are due (#413): the same predicate as the share claim.
    or exists (
      select 1 from public.sheet_syncs s
      where s.shares_due_at <= pg_catalog.now() and private.sheet_shares_due(s))
    -- Access to remove from a file TapNShow let go of (#413): the cleanup claim's predicate.
    or exists (
      select 1 from public.sheet_share_cleanups k
      where k.retry_at <= pg_catalog.now() and (k.locked_until is null or k.locked_until < pg_catalog.now()))
    -- A push delivery is due: the same "due" predicate as private.push_claim.
    or exists (
      select 1 from public.push_deliveries d
      where d.run_after <= pg_catalog.now() and (d.locked_until is null or d.locked_until < pg_catalog.now()))
    -- A platform event waits for #platform or the Owner's email (spec §8 M9): the same "due"
    -- predicate as private.platform_events_claim.
    or exists (
      select 1 from public.platform_events e
      where e.notified_at is null and (e.locked_until is null or e.locked_until < pg_catalog.now()))
$$;

revoke execute on function
  private.sheet_shares_retire(uuid, boolean), private.sheet_syncs_retire(), private.sheet_pause_apply(uuid, public.sheet_pause_reason),
  private.sheet_share_pause(uuid, uuid, public.sheet_pause_reason), private.sheet_shares_leased(uuid, uuid),
  private.sheet_share_cleanup_finish(uuid, uuid, integer)
from public, anon, authenticated;
grant execute on function
  private.sheet_share_pause(uuid, uuid, public.sheet_pause_reason), private.sheet_shares_leased(uuid, uuid),
  private.sheet_share_cleanup_finish(uuid, uuid, integer)
to service_role;
revoke execute on function
  public.sheet_share_pause(uuid, uuid, public.sheet_pause_reason), public.sheet_share_claim(uuid, integer, integer),
  public.sheet_share_intend(uuid, uuid, text, uuid),
  public.sheet_share_save(uuid, uuid, text, uuid, public.sheet_share_state, text, public.sheet_share_reason, timestamptz),
  public.sheet_share_forget(uuid, uuid, text[]), public.sheet_share_release(uuid, uuid, bigint, timestamptz),
  public.sheet_share_retry(uuid, uuid), public.sheet_share_cleanup_claim(uuid, integer, integer),
  public.sheet_share_cleanup_retry(uuid, uuid), public.sheet_share_cleanup_finish(uuid, uuid, integer)
from public, anon, authenticated;
grant execute on function
  public.sheet_share_pause(uuid, uuid, public.sheet_pause_reason), public.sheet_share_claim(uuid, integer, integer),
  public.sheet_share_intend(uuid, uuid, text, uuid),
  public.sheet_share_save(uuid, uuid, text, uuid, public.sheet_share_state, text, public.sheet_share_reason, timestamptz),
  public.sheet_share_forget(uuid, uuid, text[]), public.sheet_share_release(uuid, uuid, bigint, timestamptz),
  public.sheet_share_retry(uuid, uuid), public.sheet_share_cleanup_claim(uuid, integer, integer),
  public.sheet_share_cleanup_retry(uuid, uuid), public.sheet_share_cleanup_finish(uuid, uuid, integer)
to service_role;
