-- #413 (docs/superpowers/specs/2026-10-20-sheet-team-sharing-design.md): who a workspace's Google
-- Sheet is shared with, what TapNShow shared, and when the share worker has something to do.
-- Latest bodies: workers_due from 20261016114843_m9_platform_lane.sql.

-- The one switch for sharing the sheet with the team: the database, the worker and the screens all
-- read it. Off until Google approves the verification (design §5); a migration switches it on.
create table private.app_flags (
  name text primary key,
  enabled boolean not null
);
alter table private.app_flags enable row level security;
insert into private.app_flags (name, enabled) values ('sheet_team_sharing', false);

create function private.app_flag(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select coalesce((select f.enabled from private.app_flags f where f.name = p_name), false) $$;

-- Google allows 600 addresses per file, hand shares included (Drive Help, read 2026-10-20).
insert into private.app_limits (name, value) values ('sheet_team_shares_max', 500);

-- One person's share, as TapNShow knows it (design §5; the planner's table in the plan's Task 3).
-- Twins: SHEET_SHARE_STATES and SHEET_SHARE_REASONS in src/shared/api/sheets.ts.
create type public.sheet_share_state as enum ('pending', 'sharing', 'shared', 'external', 'refused');
create type public.sheet_share_reason as enum ('refused', 'too_many', 'removed_in_drive');

create table public.sheet_shares (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.sheet_syncs (workspace_id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  email text not null check (email = lower(email) and char_length(email) between 3 and 320),
  state public.sheet_share_state not null default 'pending',
  permission_id text check (permission_id is null or permission_id ~ '^[A-Za-z0-9_-]{1,200}$'),
  reason public.sheet_share_reason,
  next_try_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (workspace_id, email)
);
-- The member's own row (RLS) and the user foreign key.
create index sheet_shares_user_idx on public.sheet_shares (user_id);
alter table public.sheet_shares enable row level security;
revoke all on table public.sheet_shares from anon, authenticated;
grant select (workspace_id, user_id, email, state, reason) on table public.sheet_shares to authenticated;
grant all on table public.sheet_shares to service_role;
-- The Owner reads every row of their workspace; a team member reads their own.
create policy sheet_shares_select on public.sheet_shares
  for select to authenticated
  using (private.role_of(workspace_id) = 'owner' or user_id = (select auth.uid()));

-- When the share worker has work for a sheet, with a version so a run never clears a newer mark,
-- and its own lease (shares run beside redraws on the same sheet).
alter table public.sheet_syncs
  add column shares_due_at timestamptz,
  add column shares_version bigint not null default 0,
  add column shares_run_id uuid,
  add column shares_locked_until timestamptz;

-- The one rule for who gets access: the workspace's team by account address, minus the Google
-- account that holds the sheet (it owns the file), the Owner first, then by joining order.
create function private.sheet_share_targets(p_workspace uuid)
returns table (user_id uuid, email text, "position" integer)
language sql
stable
security definer
set search_path = ''
as $$
  select r.user_id, pg_catalog.lower(u.email::text),
    (pg_catalog.row_number() over (
      order by case when r.role = 'owner' then 0 else 1 end, r.created_at, r.user_id))::integer
  from public.workspace_roles r
  join auth.users u on u.id = r.user_id
  join public.sheet_syncs s on s.workspace_id = r.workspace_id
  where r.workspace_id = p_workspace
    and u.email is not null
    and pg_catalog.lower(u.email::text) <> pg_catalog.lower(s.google_email)
$$;

-- Marks sheets' shares due now (a later retry time is brought forward) and bumps their version.
create function private.sheet_shares_mark(p_workspaces uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.sheet_syncs s
  set shares_due_at = least(coalesce(s.shares_due_at, pg_catalog.now()), pg_catalog.now()),
    shares_version = s.shares_version + 1
  where s.workspace_id = any (p_workspaces)
$$;

-- Joining, leaving and role changes (every path writes workspace_roles, so no route has to call
-- anything). A can-check-in change alone doesn't change who gets access.
create function private.sheet_team_changed()
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
    perform private.sheet_shares_mark(array(select distinct n.workspace_id from new_rows n));
  elsif TG_OP = 'DELETE' then
    perform private.sheet_shares_mark(array(select distinct o.workspace_id from old_rows o));
  else
    perform private.sheet_shares_mark(array(
      select distinct n.workspace_id
      from new_rows n
      join old_rows o on o.workspace_id = n.workspace_id and o.user_id = n.user_id
      where o.role is distinct from n.role));
  end if;
  return null;
end;
$$;
create trigger sheet_team_inserted after insert on public.workspace_roles
  referencing new table as new_rows for each statement execute function private.sheet_team_changed();
create trigger sheet_team_updated after update on public.workspace_roles
  referencing old table as old_rows new table as new_rows for each statement execute function private.sheet_team_changed();
create trigger sheet_team_deleted after delete on public.workspace_roles
  referencing old table as old_rows for each statement execute function private.sheet_team_changed();

-- A new sheet, its file, another Google account, or a pause ending.
create function private.sheet_file_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.sheet_shares_mark(array[new.workspace_id]);
  return null;
end;
$$;
create trigger sheet_file_inserted after insert on public.sheet_syncs
  for each row execute function private.sheet_file_changed();
create trigger sheet_file_updated after update of spreadsheet_id, google_email, status on public.sheet_syncs
  for each row
  when (old.spreadsheet_id is distinct from new.spreadsheet_id
    or old.google_email is distinct from new.google_email
    or old.status is distinct from new.status)
  execute function private.sheet_file_changed();

-- A sheet's shares are due: the switch is on, the sheet is active with a file, the mark's time
-- has come and no share run holds it. The share claim and workers_due use this one predicate.
create function private.sheet_shares_due(p_sheet public.sheet_syncs)
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.app_flag('sheet_team_sharing')
    and p_sheet.status = 'active'
    and p_sheet.spreadsheet_id is not null
    and p_sheet.shares_due_at is not null and p_sheet.shares_due_at <= pg_catalog.now()
    and (p_sheet.shares_locked_until is null or p_sheet.shares_locked_until < pg_catalog.now())
$$;

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
  private.app_flag(text), private.sheet_share_targets(uuid), private.sheet_shares_mark(uuid[]),
  private.sheet_team_changed(), private.sheet_file_changed(), private.sheet_shares_due(public.sheet_syncs)
from public, anon, authenticated;
-- The share claim (security invoker, service role) reads these.
grant execute on function
  private.app_flag(text), private.sheet_share_targets(uuid), private.sheet_shares_due(public.sheet_syncs)
to service_role;

-- Sheets that exist before this migration are shared when the switch turns on (design §7).
select private.sheet_shares_mark(array(select s.workspace_id from public.sheet_syncs s));
