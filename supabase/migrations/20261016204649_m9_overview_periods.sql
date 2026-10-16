-- One period for the Overview's figures and its chart (Owner, 2026-10-16): any UTC date range of
-- up to two years (the client's presets: 7 days, 30 days, 90 days, 12 months, or custom), compared
-- with the period of the same length just before. The chart's bars are days for up to 31 days,
-- weeks up to 183 days and months beyond; a bar at either edge counts only the days inside the
-- range, so the bars add up to "meetings sent". `series` replaces the fixed 12-week `weekly`.
-- Attention and health always describe now (v_now), whatever the range. Copied from 20261016150906_m9_review_fixes.sql (the newest definition).

drop function public.admin_overview(integer);
drop function private.admin_overview(integer);

create function private.admin_overview(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (pg_catalog.now() at time zone 'UTC')::date;
  v_now timestamptz := pg_catalog.now();
  v_to timestamptz;
  v_from timestamptz;
  v_span interval;
  v_unit text;
begin
  perform private.require_platform_role(false);
  if p_from is null or p_to is null or p_from > p_to or p_to > v_today or p_to - p_from > 730 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  v_from := p_from::timestamp at time zone 'UTC';
  v_to := least(v_now, (p_to + 1)::timestamp at time zone 'UTC');
  v_span := pg_catalog.make_interval(days => p_to - p_from + 1);
  v_unit := case when p_to - p_from < 31 then 'day' when p_to - p_from < 183 then 'week' else 'month' end;
  return pg_catalog.jsonb_build_object(
    'attention', pg_catalog.jsonb_build_object(
      'new_reports', (select count(*) from public.abuse_reports r where r.reviewed_at is null),
      'open_suspensions', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'workspace_id', s.workspace_id, 'workspace_name', w.name, 'reason', s.reason, 'created_at', s.created_at)
          order by s.created_at desc)
        from public.workspace_sending_suspensions s join public.workspaces w on w.id = s.workspace_id
        where s.lifted_at is null), '[]'::jsonb),
      'platform_email_used', (select count(*) from private.rate_limit_events e
        where e.key = 'invite_email:platform' and e.occurred_at > v_now - interval '24 hours'),
      'platform_email_cap', private.app_limit('invite_email_platform_per_day')
    ),
    'current', private.admin_figures(v_from, v_to),
    'previous', private.admin_figures(v_from - v_span, v_from),
    'series', pg_catalog.jsonb_build_object('unit', v_unit, 'points', (
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('start', b.start, 'meetings', coalesce(c.meetings, 0))
        order by b.start)
      from (
        select greatest(g.bucket::date, p_from) as start
        from pg_catalog.generate_series(
          pg_catalog.date_trunc(v_unit, p_from::timestamp), p_to::timestamp,
          ('1 ' || v_unit)::interval) as g(bucket)
      ) b
      left join (
        select greatest(pg_catalog.date_trunc(v_unit, m.sent_at at time zone 'UTC')::date, p_from) as start,
          count(*) as meetings
        from public.meetings m
        where m.sent_at >= v_from and m.sent_at < v_to
        group by 1
      ) c on c.start = b.start
    )),
    'health', pg_catalog.jsonb_build_object(
      'queue_waiting', (select count(*) from public.outbox_jobs j where j.status = 'pending' and j.run_after <= v_now),
      'queue_oldest', (select min(j.run_after) from public.outbox_jobs j where j.status = 'pending' and j.run_after <= v_now),
      'sheets_paused', (select count(*) from public.sheet_syncs s where s.status = 'paused'),
      'sheets_total', (select count(*) from public.sheet_syncs s),
      'senders_broken', (select count(*) from public.workspaces w join public.google_connections c on c.id = w.sender_connection_id where c.status = 'broken')
    )
  );
end;
$$;

create function public.admin_overview(p_from date, p_to date) returns jsonb language sql stable security invoker
set search_path = ''
as $$ select private.admin_overview(p_from, p_to) $$;

revoke execute on function private.admin_overview(date, date), public.admin_overview(date, date) from public, anon;
grant execute on function private.admin_overview(date, date), public.admin_overview(date, date) to authenticated;
