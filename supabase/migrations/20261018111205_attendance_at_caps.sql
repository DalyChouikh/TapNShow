-- Lists → Attendance at the product's caps (#393): `attendance_summary` decided each outcome with
-- `private.effective_status` four times per invitee row (300,000 calls for "All time" at the caps,
-- about 1 s; its search_path setting keeps Postgres from inlining it). It now counts like Home's
-- `workspace_insights` (20261017192903_home_insights_held.sql): each counted meeting's invitees,
-- answers and check-ins are joined on their own from the covering meeting indexes
-- (20261017164123_home_insights.sql), grouped by what decides the outcome, and the outcome comes
-- from a 20-row map of every (check-in, answer) pair. The counting rule stays in effective_status;
-- the map now lives in one function both reads share. Same signatures: grants and wrappers stay.

-- Every (check-in, answer) pair with its outcome, so a read runs effective_status once per pair,
-- never per invitee. '' stands for "no check-in" and "no answer", so pairs join by plain, hashable
-- equality. Stable: enum_range follows the enums.
create function private.attendance_outcomes()
returns table (actual text, answer text, status text)
language sql
stable
set search_path = ''
as $$
  select coalesce(a.actual::text, ''), coalesce(s.answer::text, ''), private.effective_status(a.actual, s.answer)
  from (select pg_catalog.unnest(pg_catalog.enum_range(null::public.attendance_actual)) union all select null) a (actual)
  cross join (select pg_catalog.unnest(pg_catalog.enum_range(null::public.response_status)) union all select null) s (answer)
$$;

revoke execute on function private.attendance_outcomes() from public, anon, authenticated;

create or replace function private.workspace_insights(p_workspace uuid, p_from timestamptz, p_to timestamptz)
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
    with held as materialized (
      -- Attendance's counted meetings, whatever the period
      select m.id, m.title, m.starts_at, m.timezone from public.meetings m
      where m.workspace_id = p_workspace and m.status = 'scheduled' and m.response_mode <> 'announcement'
        and m.starts_at <= pg_catalog.now()
    ), counted as materialized (
      select held.* from held
      where (p_from is null or held.starts_at >= p_from) and (p_to is null or held.starts_at < p_to)
    ), outcomes as materialized (
      select o.actual, o.answer, o.status from private.attendance_outcomes() o
    ), kinds as materialized (
      -- Invitees grouped by what decides their outcome, per meeting and per contact, in one pass.
      -- Each meeting's invitees, answers and check-ins are joined on their own, from the covering
      -- meeting indexes (20261017164123_home_insights.sql; the meeting and workspace conditions are
      -- implied by invitee_id; they select each side's index range, ordered by invitee id).
      select g.by_meeting, g.meeting_id, g.contact_id, o.status, g.reachable, g.answered_before, g.people
      from (
        select grouping(x.meeting_id) = 0 as by_meeting, x.meeting_id, x.contact_id,
          coalesce(x.actual::text, '') as actual, coalesce(x.answer::text, '') as answer,
          x.reachable, x.answered_before, count(*) as people
        from counted
        cross join lateral (
          select i.meeting_id, i.contact_id, am.actual, r.status as answer,
            i.email_status in ('sent', 'unknown') as reachable,
            coalesce(r.responded_at < counted.starts_at, false) as answered_before
          from public.meeting_invitees i
          left join public.responses r
            on r.invitee_id = i.id and r.meeting_id = counted.id and r.workspace_id = p_workspace
          left join public.attendance_marks am
            on am.invitee_id = i.id and am.meeting_id = counted.id and am.workspace_id = p_workspace
          where i.meeting_id = counted.id and i.workspace_id = p_workspace
        ) x
        group by grouping sets (
          (x.meeting_id, x.actual, x.answer, x.reachable, x.answered_before),
          (x.contact_id, x.actual, x.answer, x.reachable)
        )
      ) g
      join outcomes o on o.actual = g.actual and o.answer = g.answer
    ), per_meeting as materialized (
      select counted.id, counted.title, counted.starts_at, counted.timezone,
        coalesce(sum(k.people), 0) as invited,
        coalesce(sum(k.people) filter (where k.status = 'attending'), 0) as attending,
        coalesce(sum(k.people) filter (where k.status = 'late'), 0) as late,
        coalesce(sum(k.people) filter (where k.status = 'absent'), 0) as absent,
        coalesce(sum(k.people) filter (where k.status is null and k.reachable), 0) as no_reply,
        coalesce(sum(k.people) filter (where k.reachable), 0) as reachable,
        coalesce(sum(k.people) filter (where k.reachable and k.answered_before), 0) as answered_before
      from counted
      left join kinds k on k.by_meeting and k.meeting_id = counted.id
      group by counted.id, counted.title, counted.starts_at, counted.timezone
    ), missing as materialized (
      select c.id, c.full_name, t.invited, t.absent + t.no_reply as missed, t.absent, t.no_reply
      from (
        select k.contact_id, sum(k.people) as invited,
          coalesce(sum(k.people) filter (where k.status = 'absent'), 0) as absent,
          coalesce(sum(k.people) filter (where k.status is null and k.reachable), 0) as no_reply
        from kinds k
        where not k.by_meeting
        group by k.contact_id
      ) t
      join public.contacts c on c.id = t.contact_id and c.workspace_id = p_workspace
      where not c.is_adhoc and t.absent + t.no_reply > 0
      order by missed desc, t.absent desc, pg_catalog.lower(c.full_name), c.id
      limit 3 -- OFTEN_MISSING_PEOPLE (src/config/home.ts)
    )
    select pg_catalog.jsonb_build_object(
      'roster', pg_catalog.jsonb_build_object(
        'members', (select count(*) from public.contacts c where c.workspace_id = p_workspace and not c.is_adhoc),
        'lists', (select count(*) from public.lists l where l.workspace_id = p_workspace),
        'committee',
          (select count(*) from public.workspace_roles wr
            where wr.workspace_id = p_workspace and wr.role in ('admin', 'viewer'))
          + (select count(*) from public.workspace_invites wi
            where wi.workspace_id = p_workspace and wi.accepted_at is null and wi.revoked_at is null
              and wi.expires_at > pg_catalog.now())
      ),
      'held', (select count(*) from held),
      'period', (
        select pg_catalog.jsonb_build_object(
          'meetings', count(*),
          'came_average', coalesce(round(avg(pm.attending + pm.late), 1), 0),
          'invited_average', coalesce(round(avg(pm.invited), 1), 0),
          'answered_before_start',
            case when sum(pm.reachable) > 0 then round(sum(pm.answered_before) / sum(pm.reachable), 3) end
        )
        from per_meeting pm
      ),
      'chart', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id', newest.id, 'title', newest.title, 'starts_at', newest.starts_at, 'timezone', newest.timezone,
          'attending', newest.attending, 'late', newest.late, 'absent', newest.absent, 'no_reply', newest.no_reply
        ) order by newest.starts_at, newest.id)
        -- the newest INSIGHTS_CHART_MEETINGS (src/config/home.ts), shown oldest first
        from (select * from per_meeting pm order by pm.starts_at desc, pm.id desc limit 12) newest
      ), '[]'::jsonb),
      'often_missing', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'contact_id', missing.id, 'full_name', missing.full_name, 'invited', missing.invited,
          'missed', missing.missed, 'absent', missing.absent, 'no_reply', missing.no_reply
        ) order by missing.missed desc, missing.absent desc, pg_catalog.lower(missing.full_name), missing.id)
        from missing
      ), '[]'::jsonb)
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
    ), outcomes as materialized (
      select o.actual, o.answer, o.status from private.attendance_outcomes() o
    ), kinds as materialized (
      -- Invitees grouped by contact and by what decides their outcome, in one pass. Each meeting's
      -- invitees, answers and check-ins are joined on their own, index-only (the meeting and
      -- workspace conditions select each side's index range, ordered by invitee id).
      select x.contact_id, coalesce(x.actual::text, '') as actual, coalesce(x.answer::text, '') as answer,
        x.reachable, count(*) as people
      from counted
      cross join lateral (
        select i.contact_id, am.actual, r.status as answer, i.email_status in ('sent', 'unknown') as reachable
        from public.meeting_invitees i
        left join public.responses r
          on r.invitee_id = i.id and r.meeting_id = counted.id and r.workspace_id = p_workspace
        left join public.attendance_marks am
          on am.invitee_id = i.id and am.meeting_id = counted.id and am.workspace_id = p_workspace
        where i.meeting_id = counted.id and i.workspace_id = p_workspace
      ) x
      group by x.contact_id, coalesce(x.actual::text, ''), coalesce(x.answer::text, ''), x.reachable
    ), agg as materialized (
      select k.contact_id,
        sum(k.people) as invited,
        coalesce(sum(k.people) filter (where o.status = 'attending'), 0) as attending,
        coalesce(sum(k.people) filter (where o.status = 'late'), 0) as late,
        coalesce(sum(k.people) filter (where o.status = 'absent'), 0) as absent,
        coalesce(sum(k.people) filter (where o.status is null and k.reachable), 0) as no_reply
      from kinds k
      join outcomes o on o.actual = k.actual and o.answer = k.answer
      group by k.contact_id
    )
    select pg_catalog.jsonb_build_object(
      'meetings', (select count(*) from counted),
      'rows', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'contact_id', c.id, 'invited', coalesce(a.invited, 0), 'attending', coalesce(a.attending, 0),
          'late', coalesce(a.late, 0), 'absent', coalesce(a.absent, 0), 'no_reply', coalesce(a.no_reply, 0)
        ) order by pg_catalog.lower(c.full_name), c.id)
        from public.contacts c
        left join agg a on a.contact_id = c.id
        where c.workspace_id = p_workspace and not c.is_adhoc
      ), '[]'::jsonb)
    )
  );
end;
$$;
