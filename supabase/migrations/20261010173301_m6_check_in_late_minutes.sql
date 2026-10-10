-- Owner feedback #257 (2026-10-10): how late someone was at the door. A Late check-in can carry
-- minutes (1–240, like an answer's delay); "Mark the rest" copies a Late answer's own minutes; every
-- read returns them through one private.mark_json (four copies of the mark object before).
-- Latest bodies: mark_attendance, mark_rest_as_declared, contact_history, attendance_details from
-- 20261010002341_m6_check_in.sql; meeting_people from 20261009235635_m6_edit_cancel.sql.

alter table public.attendance_marks
  add column late_minutes smallint check (late_minutes between 1 and 240),
  add constraint attendance_marks_late_minutes_only_late check (late_minutes is null or actual = 'late');

-- A check-in as every read returns it (null without a mark). Twin: dbMarkSchema
-- (src/server/queries/results.ts).
create function private.mark_json(p_mark public.attendance_marks, p_marked_by_name text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p_mark.invitee_id is null then null else pg_catalog.jsonb_build_object(
    'actual', p_mark.actual, 'late_minutes', p_mark.late_minutes, 'marked_at', p_mark.marked_at,
    'marked_by_name', p_marked_by_name) end
$$;
revoke execute on function private.mark_json(public.attendance_marks, text) from public, anon, authenticated;

-- A new optional argument changes the signature: drop, create, grant again.
drop function public.mark_attendance(uuid, uuid, public.attendance_actual);
drop function private.mark_attendance(uuid, uuid, public.attendance_actual);
create function private.mark_attendance(
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


revoke execute on function private.mark_attendance(uuid, uuid, public.attendance_actual, smallint) from public, anon;
grant execute on function private.mark_attendance(uuid, uuid, public.attendance_actual, smallint) to authenticated;
create function public.mark_attendance(
  p_meeting uuid, p_invitee uuid, p_actual public.attendance_actual default null, p_late_minutes smallint default null
)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.mark_attendance(p_meeting, p_invitee, p_actual, p_late_minutes) $$;
revoke execute on function public.mark_attendance(uuid, uuid, public.attendance_actual, smallint) from public, anon;
grant execute on function public.mark_attendance(uuid, uuid, public.attendance_actual, smallint) to authenticated;

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
        private.mark_json(am, mp.display_name) as mark
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
      private.mark_json(am, mp.display_name) as mark
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


create or replace function private.meeting_people(
  p_meeting uuid, p_filter text, p_after_name text, p_after_id uuid, p_limit integer, p_search text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_rows jsonb;
  v_count integer;
begin
  select m.workspace_id into v_workspace from public.meetings m where m.id = p_meeting;
  if v_workspace is null or not private.is_member(v_workspace) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if p_filter not in ('all', 'attending', 'late', 'absent', 'not_attending', 'no_reply', 'not_delivered', 'to_reconfirm')
    or p_limit not between 1 and 100 or pg_catalog.char_length(p_search) > 120 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  with page as (
    select i.id as invitee_id, c.id as contact_id, c.full_name, c.email, c.is_adhoc, lower(c.full_name) as sort_name,
      i.email_status, i.email_error, i.sent_at,
      case when r.id is null then null else pg_catalog.jsonb_build_object(
        'status', r.status, 'delay_minutes', r.delay_minutes, 'reason', r.reason, 'comment', r.comment,
        'after_deadline', r.after_deadline, 'updated_at', r.updated_at,
        'needs_reconfirmation', r.needs_reconfirmation) end as answer,
      private.mark_json(am, mp.display_name) as mark
    from public.meeting_invitees i
    join public.contacts c on c.id = i.contact_id
    left join public.responses r on r.invitee_id = i.id
    left join public.attendance_marks am on am.invitee_id = i.id
    left join public.profiles mp on mp.user_id = am.marked_by
    where i.meeting_id = p_meeting and i.workspace_id = v_workspace
      and case p_filter
        when 'all' then true
        when 'no_reply' then r.id is null and i.email_status in ('sent', 'unknown')
        when 'not_delivered' then i.email_status in ('failed', 'skipped')
        when 'to_reconfirm' then coalesce(r.needs_reconfirmation, false)
        else r.status::text = p_filter and not r.needs_reconfirmation
      end
      -- Names ignore case and accents ("sarra" finds "Sârra"); % and _ are plain characters.
      and (p_search is null
           or private.fold(c.full_name) like private.like_contains(private.fold(p_search))
           or c.email like private.like_contains(pg_catalog.lower(p_search)))
      and (p_after_id is null or (lower(c.full_name), i.id) > (p_after_name, p_after_id))
    order by lower(c.full_name), i.id
    limit p_limit + 1
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(page) order by page.sort_name, page.invitee_id), '[]'::jsonb),
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

