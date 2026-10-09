-- M6 foundation (spec §6, §7.5, §7.6): reminder settings, the change log, check-in marks, the
-- shared rules (deadline, complete meeting, active sender). Reminder timers come with Task 5.

insert into private.app_limits (name, value) values ('nudge_interval_hours', 12);

-- Reminder choices: the TS twin is src/config/reminders.ts. Null = off.
alter table public.workspaces
  add column default_reminder_pending_hours smallint default 24
    check (default_reminder_pending_hours in (1, 2, 6, 24, 48)),
  add column default_reminder_going_hours smallint default 2
    check (default_reminder_going_hours in (1, 2, 6, 24));
grant update (default_reminder_pending_hours, default_reminder_going_hours) on table public.workspaces to authenticated;

alter table public.meetings
  add column reminder_pending_hours smallint check (reminder_pending_hours in (1, 2, 6, 24, 48)),
  add column reminder_going_hours smallint check (reminder_going_hours in (1, 2, 6, 24)),
  add column last_nudged_at timestamptz,
  add column last_nudged_count integer check (last_nudged_count >= 0),
  add column cancelled_at timestamptz;
grant update (reminder_pending_hours, reminder_going_hours) on table public.meetings to authenticated;

-- Per-meeting jobs (reminder timers) have no invitee; per-person M6 jobs set it too, so deleting
-- a meeting removes every job that belongs to it.
alter table public.outbox_jobs
  add column meeting_id uuid references public.meetings (id) on delete cascade;
create index outbox_jobs_meeting_idx on public.outbox_jobs (meeting_id, kind, status) where meeting_id is not null;

create type public.meeting_change_kind as enum ('edit', 'cancel');
create table public.meeting_changes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  meeting_id uuid not null,
  kind public.meeting_change_kind not null,
  changes jsonb not null default '{}' check (pg_catalog.jsonb_typeof(changes) = 'object'),
  notified boolean not null,
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now(),
  foreign key (meeting_id, workspace_id) references public.meetings (id, workspace_id) on delete cascade
);
create index meeting_changes_meeting_idx on public.meeting_changes (meeting_id, workspace_id, changed_at);
create index meeting_changes_workspace_idx on public.meeting_changes (workspace_id);
create index meeting_changes_changed_by_idx on public.meeting_changes (changed_by);

create type public.attendance_actual as enum ('present', 'late', 'absent');
create table public.attendance_marks (
  invitee_id uuid primary key references public.meeting_invitees (id) on delete cascade,
  workspace_id uuid not null,
  meeting_id uuid not null,
  actual public.attendance_actual not null,
  marked_by uuid references auth.users (id) on delete set null,
  marked_at timestamptz not null default now(),
  foreign key (meeting_id, workspace_id) references public.meetings (id, workspace_id) on delete cascade
);
create index attendance_marks_meeting_idx on public.attendance_marks (meeting_id, workspace_id);
create index attendance_marks_workspace_idx on public.attendance_marks (workspace_id);
create index attendance_marks_marked_by_idx on public.attendance_marks (marked_by);

alter table public.meeting_changes enable row level security;
alter table public.attendance_marks enable row level security;
revoke all on table public.meeting_changes, public.attendance_marks from anon, authenticated;
grant select on table public.meeting_changes, public.attendance_marks to authenticated;
grant all on table public.meeting_changes, public.attendance_marks to service_role;
create policy meeting_changes_select_members on public.meeting_changes
  for select to authenticated using (private.is_member(workspace_id));
create policy attendance_marks_select_members on public.attendance_marks
  for select to authenticated using (private.is_member(workspace_id));

-- The answer-deadline rule (spec §7.2, #220): now < deadline < start. TS twin:
-- responseDeadlineProblem (src/lib/meetings/deadline.ts). The result is an error code.
create function private.response_deadline_problem(p_deadline timestamptz, p_starts_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_deadline is null then null
    when p_deadline <= pg_catalog.now() then 'deadline_in_past'
    when p_starts_at is not null and p_deadline >= p_starts_at then 'deadline_after_start'
  end
$$;

-- What a meeting needs before it can be sent or saved after sending (spec §7.2).
create function private.meeting_incomplete(p_meeting public.meetings)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_meeting.title = ''
    or p_meeting.starts_at is null
    or (p_meeting.location_mode in ('in_person', 'hybrid') and p_meeting.location_text = '')
    or (p_meeting.location_mode in ('online', 'hybrid') and p_meeting.meeting_url = '' and p_meeting.online_text = '')
    or (p_meeting.response_mode = 'attendance' and pg_catalog.cardinality(p_meeting.delay_options) = 0)
$$;

create function private.require_active_sender(p_workspace uuid)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_status public.connection_status;
  v_connected boolean;
begin
  select c.id is not null, c.status into v_connected, v_status
  from public.workspaces w
  left join public.google_connections c on c.id = w.sender_connection_id
  where w.id = p_workspace;
  if not coalesce(v_connected, false) then
    raise exception 'tn:sender_not_connected' using errcode = 'P0001';
  end if;
  if v_status <> 'active' then
    raise exception 'tn:sender_broken' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function private.response_deadline_problem(timestamptz, timestamptz),
  private.meeting_incomplete(public.meetings), private.require_active_sender(uuid)
  from public, anon, authenticated;

-- create_meeting: latest body from 20261008152332_m4_online_place.sql plus the reminder defaults.
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
    comments_enabled, footer_note, online_text, meeting_url, reminder_pending_hours, reminder_going_hours, created_by
  )
  select w.id, w.default_duration_minutes, w.timezone, w.default_response_mode, w.default_delay_options,
    w.default_reason_required, w.default_comments_enabled, w.default_footer_note,
    w.default_online_text, w.default_meeting_url, w.default_reminder_pending_hours, w.default_reminder_going_hours,
    auth.uid()
  from public.workspaces w
  where w.id = p_workspace
  returning id into v_id;
  return v_id;
end;
$$;

-- send_meeting: latest body from 20261008152332_m4_online_place.sql, with the shared rules; the
-- deadline is checked only at the first send (Invite more after the deadline is allowed, #220).
create or replace function private.send_meeting(p_meeting uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meeting public.meetings;
  v_problem text;
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
  if private.meeting_incomplete(v_meeting) then
    raise exception 'tn:meeting_incomplete' using errcode = 'P0001';
  end if;
  if v_meeting.status = 'draft' then
    v_problem := private.response_deadline_problem(v_meeting.response_deadline, v_meeting.starts_at);
    if v_problem is not null then
      raise exception 'tn:%', v_problem using errcode = 'P0001';
    end if;
  end if;
  if v_meeting.starts_at <= pg_catalog.now() then
    raise exception 'tn:meeting_in_past' using errcode = 'P0001';
  end if;
  perform private.require_active_sender(v_meeting.workspace_id);

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
