-- Workspace Home (design 2026-10-17 §3.1): the roster counts, the period's numbers, the chart and
-- "often missing" in one set-based read. It counts like Lists → Attendance (attendance_summary):
-- the same counted meetings, outcomes from private.effective_status, no reply only for reachable
-- invitees, and roster contacts only for people (pinned by home-insights.db.test.ts).

-- Each counted meeting's invitees, answers and check-ins are read through the meeting indexes that
-- also serve the meeting foreign keys. They now carry the join key and the columns this read needs,
-- so each meeting's rows come index-only and in join order (merge joins, no heap reads). Measured
-- at the product's caps (2,000 members, 150 meetings x 500 invitees, home-insights-plans.db.test):
-- "All time" went from 116 ms to 71 ms. Same names, same leading columns: every other reader and
-- the foreign keys keep using them.
drop index public.meeting_invitees_meeting_ws_idx;
create index meeting_invitees_meeting_ws_idx on public.meeting_invitees (meeting_id, workspace_id, id)
  include (contact_id, email_status);
drop index public.responses_meeting_ws_idx;
create index responses_meeting_ws_idx on public.responses (meeting_id, workspace_id, invitee_id)
  include (status, responded_at);
drop index public.attendance_marks_meeting_idx;
create index attendance_marks_meeting_idx on public.attendance_marks (meeting_id, workspace_id, invitee_id)
  include (actual);

create function private.workspace_insights(p_workspace uuid, p_from timestamptz, p_to timestamptz)
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
      select m.id, m.title, m.starts_at, m.timezone from public.meetings m
      where m.workspace_id = p_workspace and m.status = 'scheduled' and m.response_mode <> 'announcement'
        and m.starts_at <= pg_catalog.now()
        and (p_from is null or m.starts_at >= p_from) and (p_to is null or m.starts_at < p_to)
    ), outcomes as materialized (
      -- effective_status for every (check-in, answer) pair, so it runs 20 times, never per invitee
      -- (its search_path setting keeps Postgres from inlining it, and each call costs microseconds).
      -- '' stands for "no check-in" and "no answer", so pairs join by plain, hashable equality.
      select coalesce(a.actual::text, '') as actual, coalesce(s.answer::text, '') as answer,
        private.effective_status(a.actual, s.answer) as status
      from (select pg_catalog.unnest(pg_catalog.enum_range(null::public.attendance_actual)) union all select null) a (actual)
      cross join (select pg_catalog.unnest(pg_catalog.enum_range(null::public.response_status)) union all select null) s (answer)
    ), kinds as materialized (
      -- Invitees grouped by what decides their outcome, per meeting and per contact, in one pass.
      -- Each meeting's invitees, answers and check-ins are joined on their own, from the meeting
      -- indexes above (the meeting and workspace conditions are implied by invitee_id; they select
      -- each side's index range, which comes ordered by invitee id).
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

revoke execute on function private.workspace_insights(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function private.workspace_insights(uuid, timestamptz, timestamptz) to authenticated;

create function public.workspace_insights(p_workspace uuid, p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.workspace_insights(p_workspace, p_from, p_to) $$;

revoke execute on function public.workspace_insights(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.workspace_insights(uuid, timestamptz, timestamptz) to authenticated;
