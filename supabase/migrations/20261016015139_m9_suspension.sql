-- M9 (spec §6, §7.12, §8): a workspace's sending can be suspended, automatically on reports or by a
-- platform admin. A suspension pauses the workspace's queued emails (at their reserve), refuses new
-- sends by organizers, and is logged in platform_events (#platform, the Owner's email).
create type public.suspension_reason as enum ('auto_reports', 'platform_admin');

create table public.workspace_sending_suspensions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  reason public.suspension_reason not null,
  created_at timestamptz not null default pg_catalog.now(),
  created_by uuid references auth.users (id) on delete set null,
  lifted_at timestamptz,
  lifted_by uuid references auth.users (id) on delete set null
);
create unique index workspace_sending_suspensions_one_open
  on public.workspace_sending_suspensions (workspace_id) where lifted_at is null;
create index workspace_sending_suspensions_history_idx
  on public.workspace_sending_suspensions (workspace_id, created_at desc);
alter table public.workspace_sending_suspensions enable row level security;
revoke all on table public.workspace_sending_suspensions from anon, authenticated;
-- Members see that (and since when) their workspace is suspended; who suspended it stays internal.
grant select (id, workspace_id, reason, created_at, lifted_at) on table public.workspace_sending_suspensions to authenticated;
create policy workspace_sending_suspensions_select_member on public.workspace_sending_suspensions
  for select to authenticated using (private.is_member(workspace_id));

-- The rule counts distinct people emailed per workspace in a window.
create index send_log_workspace_time_idx on public.send_log (workspace_id, sent_at);

insert into private.app_limits (name, value) values
  ('suspension_window_days', 7),
  ('suspension_reports_min', 3),
  ('suspension_report_rate_min_bp', 200);

create function private.workspace_suspended(p_workspace uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_sending_suspensions s where s.workspace_id = p_workspace and s.lifted_at is null)
$$;
revoke execute on function private.workspace_suspended(uuid) from public, anon, authenticated;
grant execute on function private.workspace_suspended(uuid) to service_role;

create function private.open_suspension(
  p_workspace uuid, p_reason public.suspension_reason, p_actor uuid, p_facts jsonb
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.workspace_sending_suspensions (workspace_id, reason, created_by)
  values (p_workspace, p_reason, p_actor)
  on conflict (workspace_id) where lifted_at is null do nothing
  returning id into v_id;
  if v_id is null then
    return false;
  end if;
  update public.outbox_jobs j set status = 'paused', last_error = 'suspended', locked_until = null
  where j.workspace_id = p_workspace and j.status = 'pending' and j.invitee_id is not null;
  perform private.record_platform_event(
    case p_reason when 'auto_reports' then 'auto_suspended'::public.platform_event_kind else 'suspended'::public.platform_event_kind end,
    p_workspace, p_actor, p_facts);
  return true;
end;
$$;
revoke execute on function private.open_suspension(uuid, public.suspension_reason, uuid, jsonb) from public, anon, authenticated;

create function private.lift_suspension(p_workspace uuid, p_actor uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.workspace_sending_suspensions set lifted_at = pg_catalog.now(), lifted_by = p_actor
  where workspace_id = p_workspace and lifted_at is null;
  if not found then
    return false;
  end if;
  -- Resumed jobs go through the normal path: a meeting that started meanwhile fails at its
  -- reserve as today ("meeting started"), so nothing late goes out.
  update public.outbox_jobs j set status = 'pending', run_after = pg_catalog.now(), last_error = null
  where j.workspace_id = p_workspace and j.status = 'paused' and j.last_error = 'suspended';
  perform private.record_platform_event('lifted', p_workspace, p_actor, '{}'::jsonb);
  return true;
end;
$$;
revoke execute on function private.lift_suspension(uuid, uuid) from public, anon, authenticated;

-- After each "Not my group" report (spec §7.12). Counts only; the advisory lock per workspace makes
-- simultaneous reports take turns, and the unique open row keeps it to one suspension.
create function private.check_auto_suspension()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window interval := pg_catalog.make_interval(days => private.app_limit('suspension_window_days'));
  v_since timestamptz;
  v_reports integer;
  v_people integer;
  v_facts jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('suspension:' || new.workspace_id::text));
  select greatest(pg_catalog.now() - v_window, coalesce(max(s.lifted_at), '-infinity'::timestamptz)) into v_since
  from public.workspace_sending_suspensions s where s.workspace_id = new.workspace_id;
  -- People, not rows: one person invited to several meetings can report from each invitation.
  -- A report whose contact was deleted since counts as its own person.
  select count(distinct coalesce(r.contact_id::text, r.id::text)) into v_reports from public.abuse_reports r
  where r.workspace_id = new.workspace_id and r.reported_at > v_since;
  select count(distinct i.contact_id) into v_people
  from public.send_log l
  join public.outbox_jobs j on j.id = l.job_id
  join public.meeting_invitees i on i.id = j.invitee_id
  where l.workspace_id = new.workspace_id and l.sent_at > pg_catalog.now() - v_window;
  v_facts := pg_catalog.jsonb_build_object('reports', v_reports, 'people', v_people);
  perform private.record_platform_event('report', new.workspace_id, null, v_facts);
  if v_reports >= private.app_limit('suspension_reports_min')
     and v_reports * 10000 >= private.app_limit('suspension_report_rate_min_bp') * greatest(v_people, 1) then
    perform private.open_suspension(new.workspace_id, 'auto_reports', null, v_facts);
  end if;
  return null;
end;
$$;
revoke execute on function private.check_auto_suspension() from public, anon, authenticated;
create trigger abuse_reports_auto_suspension after insert on public.abuse_reports
  for each row execute function private.check_auto_suspension();

-- Every send passes here right before Gmail: a suspended workspace's job pauses ("gone" to the
-- dispatcher, which moves on). The body is unchanged, only renamed.
alter function public.dispatch_reserve(uuid, text) rename to dispatch_reserve_unchecked;
alter function public.dispatch_reserve_unchecked(uuid, text) set schema private;
create function public.dispatch_reserve(p_job uuid, p_token_hash text default null)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.outbox_jobs j set status = 'paused', last_error = 'suspended', locked_until = null
  where j.id = p_job and j.status = 'processing' and private.workspace_suspended(j.workspace_id);
  if found then
    return pg_catalog.jsonb_build_object('kind', 'gone');
  end if;
  return private.dispatch_reserve_unchecked(p_job, p_token_hash);
end;
$$;
revoke execute on function public.dispatch_reserve(uuid, text) from public, anon, authenticated;
grant execute on function public.dispatch_reserve(uuid, text) to service_role;

create function private.assert_meeting_can_send(p_meeting uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- Only the workspace's organizers learn that it is suspended; anyone else gets the send's own
  -- refusal (not found, forbidden) from the body that follows.
  if exists (
    select 1 from public.meetings m
    join public.workspace_sending_suspensions s on s.workspace_id = m.workspace_id and s.lifted_at is null
    where m.id = p_meeting
      and private.is_member(m.workspace_id, array['owner', 'admin']::public.workspace_role[])
  ) then
    raise exception 'tn:sending_suspended' using errcode = 'P0001';
  end if;
end;
$$;

-- Copied from Task 3 (<ts>_m9_write_limits.sql); the suspension check comes before the limit.
create or replace function public.send_meeting(p_meeting uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.assert_meeting_can_send(p_meeting); select private.require_user_limit('meeting_send'); select private.send_meeting(p_meeting) $$;
create or replace function public.nudge_meeting(p_meeting uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.assert_meeting_can_send(p_meeting); select private.require_user_limit('meeting_nudge'); select private.nudge_meeting(p_meeting) $$;

-- An edit is refused only when it would email someone: the body's dry run says how many (it
-- returns before spending any limit). A definer helper, so the wrapper needn't read suspensions.
create function private.assert_edit_can_send(
  p_meeting uuid, p_fields jsonb, p_notify boolean, p_dry_run boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid := (select m.workspace_id from public.meetings m where m.id = p_meeting);
  v_preview jsonb;
begin
  -- As for sends: only organizers learn about the suspension; the body refuses anyone else.
  if coalesce(p_dry_run, false) or v_workspace is null
     or not private.is_member(v_workspace, array['owner', 'admin']::public.workspace_role[])
     or not private.workspace_suspended(v_workspace) then
    return;
  end if;
  v_preview := private.edit_sent_meeting(p_meeting, p_fields, p_notify, true);
  if coalesce((v_preview ->> 'emails')::integer, 0) + coalesce((v_preview ->> 'calendar_only')::integer, 0) > 0 then
    raise exception 'tn:sending_suspended' using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function private.assert_edit_can_send(uuid, jsonb, boolean, boolean) from public, anon;
grant execute on function private.assert_edit_can_send(uuid, jsonb, boolean, boolean) to authenticated;

create or replace function public.edit_sent_meeting(
  p_meeting uuid, p_fields jsonb, p_notify boolean default false, p_dry_run boolean default false
)
returns jsonb language sql security invoker set search_path = ''
as $$
  select private.assert_edit_can_send(p_meeting, p_fields, p_notify, p_dry_run);
  select private.edit_sent_meeting(p_meeting, p_fields, p_notify, p_dry_run)
$$;

-- The platform's daily email cap reached: one event a day (spec §7.19 Needs attention).
create function private.note_platform_email_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap integer := private.app_limit('invite_email_platform_per_day');
begin
  if (select count(*) from private.rate_limit_events e
      where e.key = 'invite_email:platform' and e.occurred_at > pg_catalog.now() - interval '24 hours') >= v_cap
     and not exists (select 1 from public.platform_events p
      where p.kind = 'platform_email_cap' and p.created_at > pg_catalog.now() - interval '24 hours') then
    perform private.record_platform_event('platform_email_cap', null, null, pg_catalog.jsonb_build_object('cap', v_cap));
  end if;
  return null;
end;
$$;
revoke execute on function private.note_platform_email_cap() from public, anon, authenticated;
create trigger rate_limit_events_platform_cap after insert on private.rate_limit_events
  for each row when (new.key = 'invite_email:platform') execute function private.note_platform_email_cap();

-- A worker lane crashed (the internal route's after() work): at most one event per lane per hour.
create function private.record_worker_failure(p_lane text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_lane not in ('emails', 'sheets', 'push', 'platform') then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('worker_failing:' || p_lane));
  if not exists (select 1 from public.platform_events e
      where e.kind = 'worker_failing' and e.facts ->> 'lane' = p_lane and e.created_at > pg_catalog.now() - interval '1 hour') then
    perform private.record_platform_event('worker_failing', null, null, pg_catalog.jsonb_build_object('lane', p_lane));
  end if;
end;
$$;
create function public.record_worker_failure(p_lane text) returns void language sql security invoker set search_path = ''
as $$ select private.record_worker_failure(p_lane) $$;
revoke execute on function private.record_worker_failure(text), public.record_worker_failure(text) from public, anon, authenticated;
grant execute on function private.record_worker_failure(text), public.record_worker_failure(text) to service_role;

-- Platform admins suspend and lift by hand (confirm dialogs in the UI).
create function private.admin_suspend(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_role(false);
  if not exists (select 1 from public.workspaces w where w.id = p_workspace) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('suspension:' || p_workspace::text));
  if not private.open_suspension(p_workspace, 'platform_admin', auth.uid(), '{}'::jsonb) then
    raise exception 'tn:conflict' using errcode = 'P0001';
  end if;
end;
$$;
create function private.admin_lift(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_role(false);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('suspension:' || p_workspace::text));
  if not private.lift_suspension(p_workspace, auth.uid()) then
    raise exception 'tn:conflict' using errcode = 'P0001';
  end if;
end;
$$;
create function public.admin_suspend(p_workspace uuid) returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('admin_write'); select private.admin_suspend(p_workspace) $$;
create function public.admin_lift(p_workspace uuid) returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('admin_write'); select private.admin_lift(p_workspace) $$;
revoke execute on function private.admin_suspend(uuid), private.admin_lift(uuid), private.assert_meeting_can_send(uuid),
  public.admin_suspend(uuid), public.admin_lift(uuid) from public, anon;
grant execute on function private.admin_suspend(uuid), private.admin_lift(uuid), private.assert_meeting_can_send(uuid),
  public.admin_suspend(uuid), public.admin_lift(uuid) to authenticated;
