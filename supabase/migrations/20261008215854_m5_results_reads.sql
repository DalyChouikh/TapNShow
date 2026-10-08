-- M5 organizer reads (spec §6 Access pattern (M5), §7.7): one membership check per call, then plain
-- reads (definer bodies; no per-row RLS probes), aggregates joined once, keyset pages.

create function private.meeting_results(p_meeting uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_meeting record;
begin
  select m.id, m.workspace_id, m.response_mode into v_meeting from public.meetings m where m.id = p_meeting;
  if v_meeting.id is null or not private.is_member(v_meeting.workspace_id) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  return (
    with inv as materialized (
      select i.id, i.email_status, i.calendar_requested_at, r.status as answer
      from public.meeting_invitees i
      left join public.responses r on r.invitee_id = i.id
      where i.meeting_id = p_meeting
    ), jobs as materialized (
      select j.status, j.run_after
      from public.outbox_jobs j
      join inv on inv.id = j.invitee_id
      where j.kind = 'invite' and j.status in ('paused', 'pending')
    )
    select pg_catalog.jsonb_build_object(
      'response_mode', v_meeting.response_mode,
      'emails', (select pg_catalog.jsonb_build_object(
        'total', count(*),
        'queued', count(*) filter (where inv.email_status = 'queued'),
        'sent', count(*) filter (where inv.email_status = 'sent'),
        'skipped', count(*) filter (where inv.email_status = 'skipped'),
        'failed', count(*) filter (where inv.email_status = 'failed'),
        'unknown', count(*) filter (where inv.email_status = 'unknown')) from inv),
      'answers', (select pg_catalog.jsonb_build_object(
        'attending', count(*) filter (where inv.answer = 'attending'),
        'late', count(*) filter (where inv.answer = 'late'),
        'absent', count(*) filter (where inv.answer = 'absent'),
        'not_attending', count(*) filter (where inv.answer = 'not_attending'),
        'no_reply', count(*) filter (where inv.answer is null and inv.email_status in ('sent', 'unknown')),
        'calendar_requested', count(*) filter (where inv.calendar_requested_at is not null)) from inv),
      'paused', (select count(*) from jobs where jobs.status = 'paused'),
      'resumes_at', (select min(jobs.run_after) from jobs
        where jobs.status = 'pending' and jobs.run_after > pg_catalog.now() + interval '2 minutes'),
      'sender_state', (select case when c.id is null then 'missing' when c.status = 'broken' then 'broken' else 'ok' end
        from public.workspaces w left join public.google_connections c on c.id = w.sender_connection_id
        where w.id = v_meeting.workspace_id)
    )
  );
end;
$$;

create function private.meeting_people(
  p_meeting uuid, p_filter text, p_after_name text, p_after_id uuid, p_limit integer
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
  if p_filter not in ('all', 'attending', 'late', 'absent', 'not_attending', 'no_reply', 'not_delivered')
    or p_limit not between 1 and 100 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  with page as (
    select i.id as invitee_id, c.id as contact_id, c.full_name, c.email, c.is_adhoc, lower(c.full_name) as sort_name,
      i.email_status, i.email_error, i.sent_at,
      case when r.id is null then null else pg_catalog.jsonb_build_object(
        'status', r.status, 'delay_minutes', r.delay_minutes, 'reason', r.reason, 'comment', r.comment,
        'after_deadline', r.after_deadline, 'updated_at', r.updated_at) end as answer
    from public.meeting_invitees i
    join public.contacts c on c.id = i.contact_id
    left join public.responses r on r.invitee_id = i.id
    where i.meeting_id = p_meeting and i.workspace_id = v_workspace
      and case p_filter
        when 'all' then true
        when 'no_reply' then r.id is null and i.email_status in ('sent', 'unknown')
        when 'not_delivered' then i.email_status in ('failed', 'skipped')
        else r.status::text = p_filter
      end
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

create function private.contact_history(
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
        r.status,
        case when r.id is null then null else pg_catalog.jsonb_build_object(
          'status', r.status, 'delay_minutes', r.delay_minutes, 'reason', r.reason, 'comment', r.comment,
          'after_deadline', r.after_deadline, 'updated_at', r.updated_at) end as answer
      from public.meeting_invitees i
      join public.meetings m on m.id = i.meeting_id
      left join public.responses r on r.invitee_id = i.id
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
        'attending', count(*) filter (where hist.status = 'attending'),
        'late', count(*) filter (where hist.status = 'late'),
        'absent', count(*) filter (where hist.status in ('absent', 'not_attending')),
        'no_reply', count(*) filter (where hist.status is null and hist.email_status in ('sent', 'unknown'))) from hist),
      'has_more', (select count(*) > p_limit from page),
      'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'meeting_id', numbered.meeting_id, 'title', numbered.title, 'starts_at', numbered.starts_at,
          'timezone', numbered.timezone, 'response_mode', numbered.response_mode,
          'email_status', numbered.email_status, 'answer', numbered.answer) order by numbered.n)
        from numbered where numbered.n <= p_limit), '[]'::jsonb)
    )
  );
end;
$$;

create function private.attendance_summary(p_workspace uuid, p_from timestamptz, p_to timestamptz)
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
        count(r.id) filter (where r.status = 'attending') as attending,
        count(r.id) filter (where r.status = 'late') as late,
        count(r.id) filter (where r.status in ('absent', 'not_attending')) as absent,
        count(*) filter (where r.id is null and i.email_status in ('sent', 'unknown')) as no_reply
      from public.meeting_invitees i
      join counted on counted.id = i.meeting_id
      left join public.responses r on r.invitee_id = i.id
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

create function private.attendance_details(
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
        'after_deadline', r.after_deadline, 'updated_at', r.updated_at) end as answer
    from public.meetings m
    join public.meeting_invitees i on i.meeting_id = m.id
    join public.contacts c on c.id = i.contact_id
    left join public.responses r on r.invitee_id = i.id
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

revoke execute on function private.meeting_results(uuid), private.meeting_people(uuid, text, text, uuid, integer),
  private.contact_history(uuid, timestamptz, timestamptz, timestamptz, uuid, integer),
  private.attendance_summary(uuid, timestamptz, timestamptz),
  private.attendance_details(uuid, timestamptz, timestamptz, timestamptz, uuid, text, uuid, integer)
  from public, anon;
grant execute on function private.meeting_results(uuid), private.meeting_people(uuid, text, text, uuid, integer),
  private.contact_history(uuid, timestamptz, timestamptz, timestamptz, uuid, integer),
  private.attendance_summary(uuid, timestamptz, timestamptz),
  private.attendance_details(uuid, timestamptz, timestamptz, timestamptz, uuid, text, uuid, integer)
  to authenticated;

create function public.meeting_results(p_meeting uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.meeting_results(p_meeting) $$;

create function public.meeting_people(
  p_meeting uuid, p_filter text default 'all', p_after_name text default null, p_after_id uuid default null,
  p_limit integer default 50
)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.meeting_people(p_meeting, p_filter, p_after_name, p_after_id, p_limit) $$;

create function public.contact_history(
  p_contact uuid, p_from timestamptz default null, p_to timestamptz default null,
  p_after_starts timestamptz default null, p_after_meeting uuid default null, p_limit integer default 50
)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.contact_history(p_contact, p_from, p_to, p_after_starts, p_after_meeting, p_limit) $$;

create function public.attendance_summary(p_workspace uuid, p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.attendance_summary(p_workspace, p_from, p_to) $$;

create function public.attendance_details(
  p_workspace uuid, p_from timestamptz default null, p_to timestamptz default null,
  p_after_starts timestamptz default null, p_after_meeting uuid default null, p_after_name text default null,
  p_after_invitee uuid default null, p_limit integer default 100
)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.attendance_details(p_workspace, p_from, p_to, p_after_starts, p_after_meeting, p_after_name, p_after_invitee, p_limit) $$;

revoke execute on function public.meeting_results(uuid), public.meeting_people(uuid, text, text, uuid, integer),
  public.contact_history(uuid, timestamptz, timestamptz, timestamptz, uuid, integer),
  public.attendance_summary(uuid, timestamptz, timestamptz),
  public.attendance_details(uuid, timestamptz, timestamptz, timestamptz, uuid, text, uuid, integer)
  from public, anon;
grant execute on function public.meeting_results(uuid), public.meeting_people(uuid, text, text, uuid, integer),
  public.contact_history(uuid, timestamptz, timestamptz, timestamptz, uuid, integer),
  public.attendance_summary(uuid, timestamptz, timestamptz),
  public.attendance_details(uuid, timestamptz, timestamptz, timestamptz, uuid, text, uuid, integer)
  to authenticated;
