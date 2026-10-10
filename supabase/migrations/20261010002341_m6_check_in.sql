-- M6 check-in (spec §7.8) and "check-in wins" in History and Attendance (spec §7.7).

-- Owners, Admins, and Viewers with can_check_in (spec §3, §7.8).
create function private.can_check_in(p_workspace uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_roles r
    where r.workspace_id = p_workspace and r.user_id = auth.uid()
      and (r.role in ('owner', 'admin') or r.can_check_in)
  )
$$;

-- The meeting if the caller may check people in now; raises otherwise.
create function private.check_in_meeting(p_meeting uuid)
returns public.meetings
language plpgsql
stable
set search_path = ''
as $$
declare
  v public.meetings;
begin
  select * into v from public.meetings m where m.id = p_meeting;
  if v.id is null or not private.is_member(v.workspace_id) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if not private.can_check_in(v.workspace_id) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if v.status <> 'scheduled' or v.response_mode = 'announcement' or v.starts_at > pg_catalog.now() then
    raise exception 'tn:check_in_closed' using errcode = 'P0001';
  end if;
  return v;
end;
$$;

-- What counts in History and Attendance: the check-in where one exists, else the answer (RSVP
-- "not going" counts as absent). TS twin for labels: effectiveStatus (src/lib/responses/effective-status.ts).
create function private.effective_status(p_actual public.attendance_actual, p_answer public.response_status)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_actual
    when 'present' then 'attending'
    when 'late' then 'late'
    when 'absent' then 'absent'
    else case p_answer when 'not_attending' then 'absent' else p_answer::text end
  end
$$;

revoke execute on function private.can_check_in(uuid), private.check_in_meeting(uuid),
  private.effective_status(public.attendance_actual, public.response_status)
  from public, anon, authenticated;

create function private.mark_attendance(p_meeting uuid, p_invitee uuid, p_actual public.attendance_actual)
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
  if not exists (select 1 from public.meeting_invitees i where i.id = p_invitee and i.meeting_id = p_meeting) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if p_actual is null then
    delete from public.attendance_marks where invitee_id = p_invitee;
    return null;
  end if;
  insert into public.attendance_marks (invitee_id, workspace_id, meeting_id, actual, marked_by)
  values (p_invitee, v.workspace_id, p_meeting, p_actual, auth.uid())
  on conflict (invitee_id) do update
    set actual = excluded.actual, marked_by = excluded.marked_by, marked_at = pg_catalog.now()
  returning * into v_mark;
  return pg_catalog.jsonb_build_object(
    'actual', v_mark.actual, 'marked_at', v_mark.marked_at,
    'marked_by_name', (select p.display_name from public.profiles p where p.user_id = v_mark.marked_by)
  );
end;
$$;

-- "Mark the rest as they said" (spec §7.8): everyone whose invite went out and who has no mark
-- yet, from their answer; no reply counts as absent. TS twin of the mapping: declaredActual
-- (src/lib/responses/check-in.ts).
create function private.mark_rest_as_declared(p_meeting uuid)
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
  with inserted as (
    insert into public.attendance_marks (invitee_id, workspace_id, meeting_id, actual, marked_by)
    select i.id, i.workspace_id, i.meeting_id,
      case r.status when 'attending' then 'present' when 'late' then 'late' else 'absent' end::public.attendance_actual,
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

revoke execute on function private.mark_attendance(uuid, uuid, public.attendance_actual),
  private.mark_rest_as_declared(uuid) from public, anon;
grant execute on function private.mark_attendance(uuid, uuid, public.attendance_actual),
  private.mark_rest_as_declared(uuid) to authenticated;

create function public.mark_attendance(p_meeting uuid, p_invitee uuid, p_actual public.attendance_actual default null)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.mark_attendance(p_meeting, p_invitee, p_actual) $$;
create function public.mark_rest_as_declared(p_meeting uuid)
returns integer language sql security invoker set search_path = ''
as $$ select private.mark_rest_as_declared(p_meeting) $$;
revoke execute on function public.mark_attendance(uuid, uuid, public.attendance_actual),
  public.mark_rest_as_declared(uuid) from public, anon;
grant execute on function public.mark_attendance(uuid, uuid, public.attendance_actual),
  public.mark_rest_as_declared(uuid) to authenticated;

-- The three reads: latest bodies from 20261008215854_m5_results_reads.sql; the check-in wins in
-- every count (effective_status), and items carry the mark next to the answer.
create or replace function private.contact_history(
  p_contact uuid, p_from timestamptz, p_to timestamptz, p_after_starts timestamptz, p_after_meeting uuid,
  p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
begin
  select c.workspace_id into v_workspace from public.contacts c where c.id = p_contact;
  if v_workspace is null or not private.is_member(v_workspace) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if p_limit not between 1 and 100 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return (
    with hist as materialized (
      select m.id as meeting_id, m.title, m.starts_at, m.timezone, m.response_mode, i.email_status,
        private.effective_status(am.actual, r.status) as counted,
        case when r.id is null then null else pg_catalog.jsonb_build_object(
          'status', r.status, 'delay_minutes', r.delay_minutes, 'reason', r.reason, 'comment', r.comment,
          'after_deadline', r.after_deadline, 'updated_at', r.updated_at,
          'needs_reconfirmation', r.needs_reconfirmation) end as answer,
        case when am.invitee_id is null then null else pg_catalog.jsonb_build_object(
          'actual', am.actual, 'marked_at', am.marked_at, 'marked_by_name', mp.display_name) end as mark
      from public.meeting_invitees i
      join public.meetings m on m.id = i.meeting_id
      left join public.responses r on r.invitee_id = i.id
      left join public.attendance_marks am on am.invitee_id = i.id
      left join public.profiles mp on mp.user_id = am.marked_by
      where i.contact_id = p_contact and i.workspace_id = v_workspace
        and m.status = 'scheduled' and m.response_mode <> 'announcement' and m.starts_at <= pg_catalog.now()
        and (p_from is null or m.starts_at >= p_from) and (p_to is null or m.starts_at < p_to)
    ), page as (
      select * from hist
      where p_after_meeting is null or (hist.starts_at, hist.meeting_id) < (p_after_starts, p_after_meeting)
      order by hist.starts_at desc, hist.meeting_id desc
      limit p_limit + 1
    ), numbered as (
      select page.*, row_number() over (order by page.starts_at desc, page.meeting_id desc) as n from page
    )
    select pg_catalog.jsonb_build_object(
      'counts', (select pg_catalog.jsonb_build_object(
        'attending', count(*) filter (where hist.counted = 'attending'),
        'late', count(*) filter (where hist.counted = 'late'),
        'absent', count(*) filter (where hist.counted = 'absent'),
        'no_reply', count(*) filter (where hist.counted is null and hist.email_status in ('sent', 'unknown'))) from hist),
      'has_more', (select count(*) > p_limit from page),
      'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'meeting_id', numbered.meeting_id, 'title', numbered.title, 'starts_at', numbered.starts_at,
          'timezone', numbered.timezone, 'response_mode', numbered.response_mode,
          'email_status', numbered.email_status, 'answer', numbered.answer, 'mark', numbered.mark)
          order by numbered.n)
        from numbered where numbered.n <= p_limit), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function private.attendance_summary(p_workspace uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_member(p_workspace) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  return (
    with counted as materialized (
      select m.id from public.meetings m
      where m.workspace_id = p_workspace and m.status = 'scheduled' and m.response_mode <> 'announcement'
        and m.starts_at <= pg_catalog.now()
        and (p_from is null or m.starts_at >= p_from) and (p_to is null or m.starts_at < p_to)
    ), agg as materialized (
      select i.contact_id,
        count(*) as invited,
        count(*) filter (where private.effective_status(am.actual, r.status) = 'attending') as attending,
        count(*) filter (where private.effective_status(am.actual, r.status) = 'late') as late,
        count(*) filter (where private.effective_status(am.actual, r.status) = 'absent') as absent,
        count(*) filter (where private.effective_status(am.actual, r.status) is null
          and i.email_status in ('sent', 'unknown')) as no_reply
      from public.meeting_invitees i
      join counted on counted.id = i.meeting_id
      left join public.responses r on r.invitee_id = i.id
      left join public.attendance_marks am on am.invitee_id = i.id
      group by i.contact_id
    )
    select pg_catalog.jsonb_build_object(
      'meetings', (select count(*) from counted),
      'rows', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'contact_id', c.id, 'invited', coalesce(a.invited, 0), 'attending', coalesce(a.attending, 0),
          'late', coalesce(a.late, 0), 'absent', coalesce(a.absent, 0), 'no_reply', coalesce(a.no_reply, 0)
        ) order by lower(c.full_name), c.id)
        from public.contacts c
        left join agg a on a.contact_id = c.id
        where c.workspace_id = p_workspace and not c.is_adhoc
      ), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function private.attendance_details(
  p_workspace uuid, p_from timestamptz, p_to timestamptz, p_after_starts timestamptz, p_after_meeting uuid,
  p_after_name text, p_after_invitee uuid, p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_count integer;
begin
  if not private.is_member(p_workspace) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if p_limit not between 1 and 100 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  with page as (
    select m.id as meeting_id, m.title, m.starts_at, m.timezone, m.response_mode, i.id as invitee_id,
      c.id as contact_id, c.full_name, c.email, lower(c.full_name) as sort_name, i.email_status,
      case when r.id is null then null else pg_catalog.jsonb_build_object(
        'status', r.status, 'delay_minutes', r.delay_minutes, 'reason', r.reason, 'comment', r.comment,
        'after_deadline', r.after_deadline, 'updated_at', r.updated_at,
        'needs_reconfirmation', r.needs_reconfirmation) end as answer,
      case when am.invitee_id is null then null else pg_catalog.jsonb_build_object(
        'actual', am.actual, 'marked_at', am.marked_at, 'marked_by_name', mp.display_name) end as mark
    from public.meetings m
    join public.meeting_invitees i on i.meeting_id = m.id
    join public.contacts c on c.id = i.contact_id
    left join public.responses r on r.invitee_id = i.id
    left join public.attendance_marks am on am.invitee_id = i.id
    left join public.profiles mp on mp.user_id = am.marked_by
    where m.workspace_id = p_workspace and m.status = 'scheduled' and m.response_mode <> 'announcement'
      and m.starts_at <= pg_catalog.now()
      and (p_from is null or m.starts_at >= p_from) and (p_to is null or m.starts_at < p_to)
      and (p_after_invitee is null
        or (m.starts_at, m.id, lower(c.full_name), i.id) > (p_after_starts, p_after_meeting, p_after_name, p_after_invitee))
    order by m.starts_at, m.id, lower(c.full_name), i.id
    limit p_limit + 1
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(page) order by page.starts_at, page.meeting_id, page.sort_name, page.invitee_id), '[]'::jsonb),
    count(*)
  into v_rows, v_count
  from page;
  return pg_catalog.jsonb_build_object(
    'has_more', v_count > p_limit,
    'items', coalesce((select pg_catalog.jsonb_agg(e order by t.n) from pg_catalog.jsonb_array_elements(v_rows)
      with ordinality as t(e, n) where t.n <= p_limit), '[]'::jsonb)
  );
end;
$$;
