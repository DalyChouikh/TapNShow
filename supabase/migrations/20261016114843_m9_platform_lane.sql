-- M9 (spec §8 Platform events): the dispatcher's third lane drains platform_events into #platform
-- and the Owner's email. Service role only.
alter table public.platform_events add column emailed_at timestamptz;
comment on type public.platform_event_kind is 'TS twin: PLATFORM_EVENT_KINDS in src/lib/discord/platform-events.ts (a DB test compares them).';

create function private.platform_events_claim(p_limit integer, p_lease_seconds integer)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with picked as (
    select e.id from public.platform_events e
    where e.notified_at is null and (e.locked_until is null or e.locked_until < pg_catalog.now())
    order by e.id
    limit p_limit
    for update skip locked
  ), leased as (
    update public.platform_events e set locked_until = pg_catalog.now() + pg_catalog.make_interval(secs => p_lease_seconds)
    from picked where e.id = picked.id
    returning e.*
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', l.id, 'kind', l.kind, 'workspace_id', l.workspace_id, 'workspace_name', l.workspace_name,
      'workspace_slug', w.slug, 'facts', l.facts, 'created_at', l.created_at,
      'actor_role', private.platform_role_of(l.actor_id), 'emailed_at', l.emailed_at, 'attempts', l.notify_attempts)
    order by l.id), '[]'::jsonb)
  from leased l left join public.workspaces w on w.id = l.workspace_id
$$;

-- The Owner's address for a suspension email, once per event, inside the platform's daily budget.
create function private.platform_event_owner_target(p_event bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
begin
  update public.platform_events set emailed_at = pg_catalog.now()
  where id = p_event and emailed_at is null and kind in ('auto_suspended', 'suspended', 'lifted') and workspace_id is not null
  returning workspace_id into v_workspace;
  if v_workspace is null then
    return null;
  end if;
  return private.owner_alert_target(v_workspace);
end;
$$;

create function private.platform_event_done(p_event bigint)
returns void
language sql
security definer
set search_path = ''
as $$ update public.platform_events set notified_at = pg_catalog.now(), locked_until = null where id = p_event $$;

create function private.platform_event_failed(p_event bigint)
returns integer
language sql
security definer
set search_path = ''
as $$
  update public.platform_events
  set notify_attempts = notify_attempts + 1,
    locked_until = pg_catalog.now() + pg_catalog.make_interval(mins => least(notify_attempts + 1, 30)),
    notified_at = case when notify_attempts + 1 >= private.app_limit('platform_notify_attempts_max') then pg_catalog.now() end
  where id = p_event
  returning notify_attempts
$$;

create function public.platform_events_claim(p_limit integer, p_lease_seconds integer) returns jsonb language sql security invoker set search_path = ''
as $$ select private.platform_events_claim(p_limit, p_lease_seconds) $$;
create function public.platform_event_owner_target(p_event bigint) returns jsonb language sql security invoker set search_path = ''
as $$ select private.platform_event_owner_target(p_event) $$;
create function public.platform_event_done(p_event bigint) returns void language sql security invoker set search_path = ''
as $$ select private.platform_event_done(p_event) $$;
create function public.platform_event_failed(p_event bigint) returns integer language sql security invoker set search_path = ''
as $$ select private.platform_event_failed(p_event) $$;

revoke execute on function
  private.platform_events_claim(integer, integer), private.platform_event_owner_target(bigint),
  private.platform_event_done(bigint), private.platform_event_failed(bigint),
  public.platform_events_claim(integer, integer), public.platform_event_owner_target(bigint),
  public.platform_event_done(bigint), public.platform_event_failed(bigint)
from public, anon, authenticated;
grant execute on function
  private.platform_events_claim(integer, integer), private.platform_event_owner_target(bigint),
  private.platform_event_done(bigint), private.platform_event_failed(bigint),
  public.platform_events_claim(integer, integer), public.platform_event_owner_target(bigint),
  public.platform_event_done(bigint), public.platform_event_failed(bigint)
to service_role;

-- Copied from 20261014160152_m8_push.sql, plus the platform events (moved here from Task 15).
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
