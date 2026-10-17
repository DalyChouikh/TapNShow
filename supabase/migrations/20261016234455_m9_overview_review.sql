-- Overview review (2026-10-17): each bar carries its last day (`end`), so a week or a month the
-- period cuts is named by its days and the client knows whether the last bar is still filling
-- from the data itself; a period that runs past today (a device clock a little ahead) ends today
-- instead of failing. Copied from 20261016204649_m9_overview_periods.sql (the newest definition);
-- same signature, so the grants and the public wrapper stay.

-- Answers before the start are rolled up per day like the email counts (2026-10-17): a 12-month
-- Overview counted every invitation of the period live (1.04M invitations over two years: ~1 s per
-- period, so ~2 s for the figures and the period before). A meeting's answers are final once it
-- starts (`responded_at` is written by the first answer only), so the nightly rollup keeps
-- invitations and answers per start day (the last 29 days recomputed, like the emails) and the
-- readers count live only the meetings that started after the rollup's mark. History is backfilled
-- once below.

alter table public.platform_daily
  add column invited integer not null default 0,
  add column answered integer not null default 0;

-- The live answers and the nightly rollup read the meetings that ask for answers by their start
-- time, platform-wide. Partial (their exact filter), so it serves only them: a workspace's own reads
-- (Sheets, the meetings list) keep their workspace-led indexes.
create index meetings_answers_start_idx on public.meetings (starts_at)
  where status = 'scheduled' and response_mode <> 'announcement';

-- The days a reader takes from platform_daily ([first_day, last_rolled]) and the instant it counts
-- live rows from (live_from), for [p_from, p_to) and the rollup's mark: the one split for every
-- rolled-up figure. `p_from` is a UTC midnight.
create function private.rollup_bounds(p_from timestamptz, p_to timestamptz)
returns table (first_day date, last_rolled date, live_from timestamptz)
language sql
stable
security definer
-- Always one row: the planner's default guess (1,000) made the readers hash-join whole tables.
rows 1
set search_path = ''
as $$
  select (p_from at time zone 'UTC')::date,
    least(m.day, ((p_to - interval '1 microsecond') at time zone 'UTC')::date),
    greatest(p_from, ((m.day + 1)::timestamp) at time zone 'UTC')
  from (select coalesce((select s.rolled_through from public.platform_rollup_state s), '-infinity'::date) as day) m
$$;
revoke execute on function private.rollup_bounds(timestamptz, timestamptz) from public, anon, authenticated;

-- Copied from 20261016150906_m9_review_fixes.sql; the bounds now come from rollup_bounds.
create or replace function private.email_counts(p_from timestamptz, p_to timestamptz, p_workspaces uuid[])
returns table (workspace_id uuid, sent bigint, failed bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (select * from private.rollup_bounds(p_from, p_to)),
  rolled as (
    select d.workspace_id, sum(d.emails_sent)::bigint as sent, sum(d.emails_failed)::bigint as failed
    from public.platform_daily d, bounds b
    where d.workspace_id = any(p_workspaces) and d.day >= b.first_day and d.day <= b.last_rolled
    group by 1
  ),
  live_sent as (
    select l.workspace_id, count(*) as sent
    from public.send_log l, bounds b
    where l.workspace_id = any(p_workspaces) and l.sent_at >= b.live_from and l.sent_at < p_to
    group by 1
  ),
  live_failed as (
    select j.workspace_id, count(*) as failed
    from public.outbox_jobs j, bounds b
    where j.workspace_id = any(p_workspaces) and j.status = 'failed' and j.invitee_id is not null
      and j.updated_at >= b.live_from and j.updated_at < p_to
    group by 1
  )
  select coalesce(r.workspace_id, s.workspace_id, f.workspace_id),
    coalesce(r.sent, 0) + coalesce(s.sent, 0), coalesce(r.failed, 0) + coalesce(f.failed, 0)
  from rolled r
  full join live_sent s on s.workspace_id = r.workspace_id
  full join live_failed f on f.workspace_id = coalesce(r.workspace_id, s.workspace_id)
$$;

-- Invitations emailed and answers given before the start, per workspace and UTC start day, for
-- the meetings that started on [p_first, p_before): recomputed whole (a day whose meetings were
-- deleted goes back to zero).
create function private.rollup_answers(p_first date, p_before date)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.platform_daily d set invited = 0, answered = 0
  where d.day >= p_first and d.day < p_before and (d.invited <> 0 or d.answered <> 0);
  insert into public.platform_daily (day, workspace_id, invited, answered)
  select (m.starts_at at time zone 'UTC')::date, m.workspace_id, count(*),
    count(r.id) filter (where r.responded_at <= m.starts_at)
  from public.meetings m
  join public.meeting_invitees i on i.meeting_id = m.id and i.email_status = 'sent'
  left join public.responses r on r.invitee_id = i.id
  where m.response_mode <> 'announcement' and m.status = 'scheduled'
    and m.starts_at >= p_first::timestamp at time zone 'UTC'
    and m.starts_at < p_before::timestamp at time zone 'UTC'
  group by 1, 2
  on conflict (day, workspace_id) do update set invited = excluded.invited, answered = excluded.answered;
$$;
revoke execute on function private.rollup_answers(date, date) from public, anon, authenticated;

-- Copied from 20261016150906_m9_review_fixes.sql; it now rolls up the answers too.
create or replace function private.rollup_platform_daily()
returns void
language sql
security definer
set search_path = ''
as $$
  with sends as (
    select (l.sent_at at time zone 'UTC')::date as day, l.workspace_id, count(*) as sent,
      count(distinct i.contact_id) as people
    from public.send_log l
    left join public.outbox_jobs j on j.id = l.job_id
    left join public.meeting_invitees i on i.id = j.invitee_id
    where l.workspace_id is not null
      and l.sent_at >= ((pg_catalog.now() at time zone 'UTC')::date - 29)::timestamp at time zone 'UTC'
      and l.sent_at < ((pg_catalog.now() at time zone 'UTC')::date)::timestamp at time zone 'UTC'
    group by 1, 2
  ), failures as (
    select (j.updated_at at time zone 'UTC')::date as day, j.workspace_id, count(*) as failed
    from public.outbox_jobs j
    where j.status = 'failed' and j.invitee_id is not null
      and j.updated_at >= ((pg_catalog.now() at time zone 'UTC')::date - 29)::timestamp at time zone 'UTC'
      and j.updated_at < ((pg_catalog.now() at time zone 'UTC')::date)::timestamp at time zone 'UTC'
    group by 1, 2
  )
  insert into public.platform_daily (day, workspace_id, emails_sent, emails_failed, people_emailed)
  select coalesce(s.day, f.day), coalesce(s.workspace_id, f.workspace_id), coalesce(s.sent, 0), coalesce(f.failed, 0), coalesce(s.people, 0)
  from sends s full join failures f on f.day = s.day and f.workspace_id = s.workspace_id
  where exists (select 1 from public.workspaces w where w.id = coalesce(s.workspace_id, f.workspace_id))
  on conflict (day, workspace_id) do update
    set emails_sent = excluded.emails_sent, emails_failed = excluded.emails_failed, people_emailed = excluded.people_emailed;
  -- Invitations and answers of the meetings that started in the same days.
  select private.rollup_answers((pg_catalog.now() at time zone 'UTC')::date - 29, (pg_catalog.now() at time zone 'UTC')::date);
  -- How far the rolled-up columns are counted: readers count live rows only after this day.
  insert into public.platform_rollup_state (id, rolled_through)
  values (true, (pg_catalog.now() at time zone 'UTC')::date - 1)
  on conflict (id) do update set rolled_through = excluded.rolled_through;
$$;

-- Invitations and answers before the start for the meetings that start in [p_from, p_to) and have
-- started: the rolled-up days, then live rows after the rollup's mark.
create function private.answer_counts(p_from timestamptz, p_to timestamptz)
returns table (invited bigint, answered bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (select * from private.rollup_bounds(p_from, p_to)),
  rolled as (
    select coalesce(sum(d.invited), 0)::bigint as invited, coalesce(sum(d.answered), 0)::bigint as answered
    from public.platform_daily d, bounds b
    where d.day >= b.first_day and d.day <= b.last_rolled
  ),
  -- A day or two of meetings at most: each one's invitations read through its own index.
  live as (
    select coalesce(sum(x.invited), 0)::bigint as invited, coalesce(sum(x.answered), 0)::bigint as answered
    from bounds b
    join public.meetings m on m.starts_at >= b.live_from and m.starts_at < least(p_to, pg_catalog.now())
    cross join lateral (
      select count(*) as invited, count(r.id) filter (where r.responded_at <= m.starts_at) as answered
      from public.meeting_invitees i
      left join public.responses r on r.invitee_id = i.id
      where i.meeting_id = m.id and i.email_status = 'sent'
    ) x
    where m.response_mode <> 'announcement' and m.status = 'scheduled'
  )
  select r.invited + l.invited, r.answered + l.answered from rolled r, live l
$$;
revoke execute on function private.answer_counts(timestamptz, timestamptz) from public, anon, authenticated;

-- Copied from 20261016150906_m9_review_fixes.sql; the answers come from answer_counts.
create or replace function private.admin_figures(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with emails as (
    select coalesce(sum(e.sent), 0) as sent, coalesce(sum(e.failed), 0) as failed
    from private.email_counts(p_from, p_to, array(select w.id from public.workspaces w)) e
  ),
  pushes as (
    -- Push counters are written to today's row as they happen: no live part.
    select coalesce(sum(d.pushes_sent), 0) as sent, coalesce(sum(d.pushes_failed), 0) as failed
    from public.platform_daily d
    where d.day >= (p_from at time zone 'UTC')::date
      and d.day <= ((p_to - interval '1 microsecond') at time zone 'UTC')::date
  ),
  answered as (select * from private.answer_counts(p_from, p_to))
  select pg_catalog.jsonb_build_object(
    'workspaces_total', (select count(*) from public.workspaces w where w.created_at < p_to),
    'workspaces_new', (select count(*) from public.workspaces w where w.created_at >= p_from and w.created_at < p_to),
    'active_workspaces', (select count(distinct m.workspace_id) from public.meetings m where m.sent_at >= p_from and m.sent_at < p_to),
    'meetings_sent', (select count(*) from public.meetings m where m.sent_at >= p_from and m.sent_at < p_to),
    'emails_sent', (select emails.sent from emails),
    'emails_failed', (select emails.failed from emails),
    'answers_rate_bp', (select case when a.invited = 0 then null else (a.answered * 10000 / a.invited) end from answered a),
    'accounts_total', (select count(*) from auth.users u where u.created_at < p_to),
    'accounts_new', (select count(*) from auth.users u where u.created_at >= p_from and u.created_at < p_to),
    'pushes_sent', (select pushes.sent from pushes),
    'pushes_failed', (select pushes.failed from pushes)
  )
$$;

-- Backfill every day's answers once (the nightly run keeps the last 29), then roll up as tonight.
select private.rollup_answers('-infinity', (pg_catalog.now() at time zone 'UTC')::date);
select private.rollup_platform_daily();

-- Copied from 20261016204649_m9_overview_periods.sql (the newest definition).
create or replace function private.admin_overview(p_from date, p_to date)
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
  -- The period's last day: a range that runs past today (a device clock a little ahead of ours)
  -- ends today.
  v_last date := least(p_to, v_today);
begin
  perform private.require_platform_role(false);
  if p_from is null or p_to is null or p_from > v_last or v_last - p_from > 730 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  v_from := p_from::timestamp at time zone 'UTC';
  v_to := least(v_now, (v_last + 1)::timestamp at time zone 'UTC');
  v_span := pg_catalog.make_interval(days => v_last - p_from + 1);
  v_unit := case when v_last - p_from < 31 then 'day' when v_last - p_from < 183 then 'week' else 'month' end;
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
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'start', b.start, 'end', b.last_day, 'meetings', coalesce(c.meetings, 0))
        order by b.start)
      from (
        select greatest(g.bucket::date, p_from) as start,
          least((g.bucket + ('1 ' || v_unit)::interval)::date - 1, v_last) as last_day
        from pg_catalog.generate_series(
          pg_catalog.date_trunc(v_unit, p_from::timestamp), v_last::timestamp,
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
