-- #255 (M6 minors), hardening: per-user rate limits on the check-in taps, and no service_role
-- EXECUTE on public.nudge_meeting (its private body was never granted to that role).
-- Latest bodies: hit_user_rate_limit from 20261011091257_m7_sheet_state.sql; mark_attendance,
-- mark_rest_as_declared from 20261010173301_m6_check_in_late_minutes.sql.

-- Generous: a door team marks one person per tap (a 2,000-person roster fits), and "Mark the rest"
-- is one tap per meeting.
insert into private.app_limits (name, value) values
  ('check_in_marks_per_user_per_hour', 3000),
  ('check_in_rests_per_user_per_hour', 60);

-- hit_user_rate_limit: plus the check-in taps.
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
    when 'check_in_mark' then 'check_in_marks_per_user_per_hour'
    when 'check_in_rest' then 'check_in_rests_per_user_per_hour'
  end;
begin
  if v_user is null or v_limit_name is null then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return private.hit_rate_limit(p_action || ':user:' || v_user::text, private.app_limit(v_limit_name), interval '1 hour');
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
  -- Minutes only with Late, within the answer page's bounds (twin: LATE_MINUTES_MAX).
  if p_late_minutes is not null and (p_actual <> 'late' or p_late_minutes not between 1 and 240) then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
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

create or replace function private.mark_rest_as_declared(p_meeting uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.meetings;
  v_count integer;
begin
  v := private.check_in_meeting(p_meeting);
  if not private.hit_user_rate_limit('check_in_rest') then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;
  with inserted as (
    insert into public.attendance_marks (invitee_id, workspace_id, meeting_id, actual, late_minutes, marked_by)
    select i.id, i.workspace_id, i.meeting_id,
      case r.status when 'attending' then 'present' when 'late' then 'late' else 'absent' end::public.attendance_actual,
      case when r.status = 'late' then r.delay_minutes end,
      auth.uid()
    from public.meeting_invitees i
    left join public.responses r on r.invitee_id = i.id
    where i.meeting_id = p_meeting and i.email_status in ('sent', 'unknown')
    on conflict (invitee_id) do nothing
    returning 1
  )
  select count(*) into v_count from inserted;
  return v_count;
end;
$$;

revoke execute on function public.nudge_meeting(uuid) from service_role;
