-- A late time is always shorter than its meeting (#400): the delay choices, so a member's late
-- answer (one of them), and a Late check-in's minutes are 1 to least(240, length - 1) minutes.
-- TypeScript twins: lateMinutesMax and fittingDelays (src/lib/meetings/late.ts), pinned by
-- late-fits-meeting.db.test.ts. A sent meeting's choices stay fixed, so its length may only shrink
-- while they fit; nobody's answer is ever changed.

-- The longest late time a meeting allows (240: LATE_MINUTES_MAX in src/config/meetings.ts).
create function private.late_minutes_max(p_duration integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select least(240, p_duration - 1)
$$;

-- The delay choices that fit a meeting of this length, in their order (null for null).
create function private.fitting_delays(p_options smallint[], p_duration integer)
returns smallint[]
language sql
immutable
set search_path = ''
as $$
  select case when p_options is not null then array(
    select x.v from pg_catalog.unnest(p_options) with ordinality as x(v, n)
    where x.v <= private.late_minutes_max(p_duration)
    order by x.n
  ) end
$$;

revoke execute on function private.late_minutes_max(integer), private.fitting_delays(smallint[], integer)
  from public, anon;
-- CHECK constraints run as the writing role: Owners and Admins saving drafts and defaults, and the
-- service role (test setup, workers).
grant execute on function private.late_minutes_max(integer), private.fitting_delays(smallint[], integer)
  to authenticated, service_role;

-- Choices written before this rule: keep the ones that fit. In production (read-only check,
-- 2026-10-18) that is one sent test meeting (30 min offering 30 and 45); no answer and no check-in
-- uses a choice it removes, and emails never list the choices, so nobody needs telling.
update public.meetings m
set delay_options = private.fitting_delays(m.delay_options, m.duration_minutes)
where private.fitting_delays(m.delay_options, m.duration_minutes) <> m.delay_options;
update public.workspaces w
set default_delay_options = private.fitting_delays(w.default_delay_options, w.default_duration_minutes)
where private.fitting_delays(w.default_delay_options, w.default_duration_minutes) <> w.default_delay_options;

-- Named so the API can tell this refusal apart (src/server/http/errors.ts: late_too_long).
alter table public.meetings add constraint meetings_delays_fit
  check (private.fitting_delays(delay_options, duration_minutes) = delay_options);
alter table public.workspaces add constraint workspaces_default_delays_fit
  check (private.fitting_delays(default_delay_options, default_duration_minutes) = default_delay_options);

-- Same signatures: grants and public wrappers stay.
create or replace function private.edit_sent_meeting(p_meeting uuid, p_fields jsonb, p_notify boolean, p_dry_run boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Field groups: TS twins in src/config/meeting-edit.ts (a DB test compares them).
  c_editable constant text[] := array['title', 'agenda_md', 'starts_at', 'duration_minutes', 'timezone',
    'location_mode', 'location_text', 'online_text', 'meeting_url', 'response_deadline', 'reason_required',
    'comments_enabled', 'footer_note', 'reminder_pending_hours', 'reminder_going_hours'];
  c_visible constant text[] := array['title', 'starts_at', 'duration_minutes', 'timezone', 'location_mode',
    'location_text', 'online_text', 'meeting_url', 'agenda_md', 'response_deadline', 'footer_note'];
  c_schedule constant text[] := array['starts_at', 'duration_minutes'];
  c_place constant text[] := array['location_mode', 'location_text', 'online_text', 'meeting_url'];
  c_calendar constant text[] := array['title', 'agenda_md', 'starts_at', 'duration_minutes', 'location_mode',
    'location_text', 'online_text', 'meeting_url'];
  v_old public.meetings;
  v_new public.meetings;
  v_old_json jsonb;
  v_new_json jsonb;
  v_changes jsonb;
  v_visible jsonb;
  v_keys text[];
  v_problem text;
  v_rule text;
  v_time boolean;
  v_calendar boolean;
  v_due timestamptz;
  v_emails integer;
  v_calendar_only integer;
  v_skipped text[];
begin
  if p_fields is null or p_dry_run is null or pg_catalog.jsonb_typeof(p_fields) <> 'object'
    or exists (select 1 from pg_catalog.jsonb_object_keys(p_fields) k where k <> all (c_editable)) then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  select * into v_old from public.meetings m where m.id = p_meeting for update;
  if v_old.id is null or not private.is_member(v_old.workspace_id) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if not private.is_member(v_old.workspace_id, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if v_old.status = 'cancelled' then
    raise exception 'tn:meeting_cancelled' using errcode = 'P0001';
  end if;
  if v_old.status <> 'scheduled' then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if v_old.starts_at <= pg_catalog.now() then
    raise exception 'tn:meeting_started' using errcode = 'P0001';
  end if;

  v_new := pg_catalog.jsonb_populate_record(v_old, p_fields);
  if not pg_catalog.isfinite(v_new.starts_at)
    or (v_new.response_deadline is not null and not pg_catalog.isfinite(v_new.response_deadline)) then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if private.meeting_incomplete(v_new) then
    raise exception 'tn:meeting_incomplete' using errcode = 'P0001';
  end if;
  -- A sent meeting's late choices are fixed, so it may only get as short as they still fit (#400):
  -- every late answer is one of them, so no answer ever ends up longer than the meeting.
  if private.fitting_delays(v_new.delay_options, v_new.duration_minutes) <> v_new.delay_options then
    raise exception 'tn:late_too_long' using errcode = 'P0001';
  end if;
  if v_new.starts_at <= pg_catalog.now() then
    raise exception 'tn:meeting_in_past' using errcode = 'P0001';
  end if;
  if v_new.response_mode = 'announcement' and v_new.response_deadline is not null then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  -- A deadline that already passed may stay as it is (spec Review Focus 3); a changed one must
  -- follow the full rule, and the start may never move to before it.
  if v_new.response_deadline is distinct from v_old.response_deadline then
    v_problem := private.response_deadline_problem(v_new.response_deadline, v_new.starts_at);
  elsif v_new.response_deadline is not null and v_new.response_deadline >= v_new.starts_at then
    v_problem := 'deadline_after_start';
  end if;
  if v_problem is not null then
    raise exception 'tn:%', v_problem using errcode = 'P0001';
  end if;

  v_old_json := pg_catalog.to_jsonb(v_old);
  v_new_json := pg_catalog.to_jsonb(v_new);
  select pg_catalog.jsonb_object_agg(k, pg_catalog.jsonb_build_array(v_old_json -> k, v_new_json -> k)),
    pg_catalog.array_agg(k)
  into v_changes, v_keys
  from pg_catalog.unnest(c_editable) as k
  where (v_old_json -> k) is distinct from (v_new_json -> k);
  if v_keys is null then
    return pg_catalog.jsonb_build_object('changed', false, 'changes', '{}'::jsonb, 'emails', 0,
      'calendar_only', 0, 'reconfirm', false, 'reminders_skipped', '[]'::jsonb);
  end if;
  select coalesce(pg_catalog.jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_visible
  from pg_catalog.jsonb_each(v_changes) e where e.key = any (c_visible);

  v_time := 'starts_at' = any (v_keys);
  v_calendar := v_keys && c_calendar;
  v_rule := case
    when v_keys && c_schedule then 'all'
    when v_keys && c_place then 'not_declined'
    when coalesce(p_notify, false) and v_keys && c_visible then 'all'
    else 'none'
  end;
  -- Reminders this edit moves into the past would be dropped without a word (#255): name them. A
  -- reminder already in the past before the edit isn't "dropped" by it, and one that already went
  -- out isn't either when only its settings change.
  v_skipped := array(
    select a.audience from pg_catalog.unnest(array['pending', 'going']) as a(audience)
    where v_keys && array['starts_at', 'response_deadline', 'reminder_pending_hours', 'reminder_going_hours']
      and private.reminder_due(v_new, a.audience) <= pg_catalog.now()
      and private.reminder_due(v_new, a.audience) is distinct from private.reminder_due(v_old, a.audience)
      and not (not (v_keys && array['starts_at', 'response_deadline']) and exists (
        select 1 from public.outbox_jobs j
        where j.meeting_id = p_meeting and j.kind = 'reminder' and j.invitee_id is null
          and j.status = 'done' and j.payload ->> 'audience' = a.audience)));
  select count(*) filter (where t.notify), count(*) filter (where not t.notify)
  into v_emails, v_calendar_only
  from private.update_targets(p_meeting, v_rule, v_calendar) t;
  if p_dry_run then
    return pg_catalog.jsonb_build_object('changed', true, 'changes', v_changes, 'emails', v_emails,
      'calendar_only', v_calendar_only, 'reconfirm', v_time, 'reminders_skipped', pg_catalog.to_jsonb(v_skipped));
  end if;
  if v_emails + v_calendar_only > 0 and not private.hit_user_rate_limit('meeting_edit_email') then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;

  update public.meetings set
    title = v_new.title, agenda_md = v_new.agenda_md, starts_at = v_new.starts_at,
    duration_minutes = v_new.duration_minutes, timezone = v_new.timezone, location_mode = v_new.location_mode,
    location_text = v_new.location_text, online_text = v_new.online_text, meeting_url = v_new.meeting_url,
    response_deadline = v_new.response_deadline, reason_required = v_new.reason_required,
    comments_enabled = v_new.comments_enabled, footer_note = v_new.footer_note,
    reminder_pending_hours = v_new.reminder_pending_hours, reminder_going_hours = v_new.reminder_going_hours,
    ics_sequence = ics_sequence + 1
  where id = p_meeting;
  if v_time then
    update public.responses set needs_reconfirmation = true
    where meeting_id = p_meeting and workspace_id = v_old.workspace_id;
  end if;
  -- A move reschedules both reminders, even one that already went out (owner decision); a change of
  -- reminder settings alone never sends a reminder that already went out again.
  if v_keys && array['starts_at', 'response_deadline'] then
    perform private.sync_reminder_timers(p_meeting, false);
  elsif v_keys && array['reminder_pending_hours', 'reminder_going_hours'] then
    perform private.sync_reminder_timers(p_meeting, true);
  end if;
  insert into public.meeting_changes (workspace_id, meeting_id, kind, changes, notified, changed_by)
  values (v_old.workspace_id, p_meeting, 'edit', v_changes, v_rule <> 'none', auth.uid());

  v_due := pg_catalog.now() + pg_catalog.make_interval(secs => private.app_limit('calendar_confirm_delay_seconds'));
  with targets as materialized (
    select * from private.update_targets(p_meeting, v_rule, v_calendar)
  ), merged as (
    -- A waiting update already starts from what the person was told; merging keeps its old values
    -- and takes this edit's new ones (a field moved back drops out in merge_update_payload).
    update public.outbox_jobs j
    set payload = private.merge_update_payload(j.payload,
          pg_catalog.jsonb_build_object('changes', v_visible, 'notify', t.notify, 'reconfirm', v_time)),
      run_after = v_due, last_error = null
    from targets t
    where j.invitee_id = t.invitee_id and j.kind = 'update' and j.status in ('pending', 'paused')
    returning j.invitee_id
  )
  -- A new update's change lines start from what the person was last told (#255).
  insert into public.outbox_jobs (kind, workspace_id, invitee_id, meeting_id, payload, idempotency_key, run_after)
  select 'update', t.workspace_id, t.invitee_id, p_meeting,
    pg_catalog.jsonb_build_object(
      'changes', private.told_changes(v_visible, p_meeting, coalesce(ti.details_told_at, ti.invited_at)),
      'notify', t.notify, 'reconfirm', v_time),
    'update:' || t.invitee_id::text || ':' || gen_random_uuid()::text, v_due
  from targets t
  join public.meeting_invitees ti on ti.id = t.invitee_id
  where t.invitee_id not in (select merged.invitee_id from merged);

  return pg_catalog.jsonb_build_object('changed', true, 'changes', v_changes, 'emails', v_emails,
    'calendar_only', v_calendar_only, 'reconfirm', v_time, 'reminders_skipped', pg_catalog.to_jsonb(v_skipped));
end;
$$;

create or replace function private.mark_attendance(
  p_meeting uuid, p_invitee uuid, p_actual public.attendance_actual, p_late_minutes smallint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.meetings;
  v_mark public.attendance_marks;
begin
  v := private.check_in_meeting(p_meeting);
  if not private.hit_user_rate_limit('check_in_mark') then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.meeting_invitees i where i.id = p_invitee and i.meeting_id = p_meeting) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if p_actual is null then
    delete from public.attendance_marks where invitee_id = p_invitee;
    return null;
  end if;
  -- Minutes only with Late, at least one, and shorter than the meeting (#400, late_minutes_max).
  if p_late_minutes is not null and (p_actual <> 'late' or p_late_minutes < 1) then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if p_late_minutes > private.late_minutes_max(v.duration_minutes) then
    raise exception 'tn:late_too_long' using errcode = 'P0001';
  end if;
  insert into public.attendance_marks (invitee_id, workspace_id, meeting_id, actual, late_minutes, marked_by)
  values (p_invitee, v.workspace_id, p_meeting, p_actual, p_late_minutes, auth.uid())
  on conflict (invitee_id) do update
    set actual = excluded.actual, late_minutes = excluded.late_minutes, marked_by = excluded.marked_by,
      marked_at = pg_catalog.now()
  returning * into v_mark;
  return private.mark_json(v_mark,
    (select p.display_name from public.profiles p where p.user_id = v_mark.marked_by));
end;
$$;
