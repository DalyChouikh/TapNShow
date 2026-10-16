-- M9 final review fixes (2026-10-16).
-- 1. The figures counted yesterday nowhere between midnight UTC and the nightly rollup (03:17):
--    the rollup now records how far it counted (`platform_rollup_state`), and one function,
--    `private.email_counts`, adds rolled-up days up to that mark and live rows after it.
-- 2. Periods start at a UTC midnight (`private.admin_period_start`), so a day is in one period only
--    and the rolled-up days match the live ones.
-- 3. Only existing workspaces are counted (a deleted workspace's send_log rows keep a null id), and
--    a workspace's failed emails of today count in its 30 days.
-- 4. Sign-in codes on shared campus Wi-Fi (Owner, 2026-10-16): 60 per IP per hour (was 20), with
--    Supabase's own auth email limit raised to 60 per hour (`AUTH_EMAILS_PER_HOUR`, auth:config).
--    A platform-wide daily cap of 360 codes keeps the platform Gmail's worst day at 360 + 100
--    invite emails = 460, under Gmail's 500 a day (spec §8 Platform Gmail budget).
-- Bodies copied from the newest migration that defines each (named at each function).

create table public.platform_rollup_state (
  id boolean primary key default true check (id),
  rolled_through date not null
);
alter table public.platform_rollup_state enable row level security;
revoke all on table public.platform_rollup_state from anon, authenticated;

update private.app_limits set value = 60 where name = 'otp_send_per_ip_per_hour';
insert into private.app_limits (name, value) values ('otp_send_platform_per_day', 360);

-- Copied from 20261015200152_m9_write_limits.sql; a code request also spends the platform's daily
-- budget, after its IP limit allowed it (a refused IP spends none of it).
create or replace function private.check_ip_rate_limit(p_action text, p_ip text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit_name text := case p_action
    when 'otp_send' then 'otp_send_per_ip_per_hour'
    when 'otp_verify' then 'otp_verify_per_ip_per_hour'
    when 'google_signin' then 'google_signin_per_ip_per_hour'
  end;
begin
  if v_limit_name is null or char_length(coalesce(p_ip, '')) not between 1 and 64 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if not private.hit_rate_limit(p_action || ':ip:' || p_ip, private.app_limit(v_limit_name), interval '1 hour') then
    return false;
  end if;
  if p_action = 'otp_send' then
    return private.hit_rate_limit('otp_send:platform', private.app_limit('otp_send_platform_per_day'), interval '1 day');
  end if;
  return true;
end;
$$;

-- The first day of the last `p_days` UTC days (today included).
create function private.admin_period_start(p_days integer)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (((pg_catalog.now() at time zone 'UTC')::date - (p_days - 1))::timestamp) at time zone 'UTC'
$$;
revoke execute on function private.admin_period_start(integer) from public, anon, authenticated;

-- Emails sent and failed per workspace in [p_from, p_to): the rolled-up days (platform_daily) up to
-- the rollup's mark, then live rows (send_log, failed jobs) after it, so no day is counted twice or
-- missed whenever the nightly rollup runs. `p_from` is a UTC midnight (admin_period_start).
create function private.email_counts(p_from timestamptz, p_to timestamptz, p_workspaces uuid[])
returns table (workspace_id uuid, sent bigint, failed bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with mark as (
    select coalesce((select s.rolled_through from public.platform_rollup_state s), '-infinity'::date) as day
  ),
  bounds as (
    select (p_from at time zone 'UTC')::date as first_day,
      least(m.day, ((p_to - interval '1 microsecond') at time zone 'UTC')::date) as last_rolled,
      greatest(p_from, ((m.day + 1)::timestamp) at time zone 'UTC') as live_from
    from mark m
  ),
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
revoke execute on function private.email_counts(timestamptz, timestamptz, uuid[]) from public, anon, authenticated;

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
  -- How far the email columns are counted: readers count live rows only after this day.
  insert into public.platform_rollup_state (id, rolled_through)
  values (true, (pg_catalog.now() at time zone 'UTC')::date - 1)
  on conflict (id) do update set rolled_through = excluded.rolled_through;
$$;

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
  answered as (
    select count(*) as invited, count(r.id) filter (where r.responded_at <= m.starts_at) as answered
    from public.meetings m
    join public.meeting_invitees i on i.meeting_id = m.id and i.email_status = 'sent'
    left join public.responses r on r.invitee_id = i.id
    where m.response_mode <> 'announcement' and m.status = 'scheduled'
      and m.starts_at >= p_from and m.starts_at < least(p_to, pg_catalog.now())
  )
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

create or replace function private.admin_overview(p_days integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_to timestamptz := pg_catalog.now();
  v_span interval;
  v_from timestamptz;
begin
  perform private.require_platform_role(false);
  if p_days not in (7, 30, 90) then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  v_span := pg_catalog.make_interval(days => p_days);
  -- Whole UTC days: "7 days" is today and the 6 days before, and the period before it never
  -- shares a day with it.
  v_from := private.admin_period_start(p_days);
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
        where e.key = 'invite_email:platform' and e.occurred_at > v_to - interval '24 hours'),
      'platform_email_cap', private.app_limit('invite_email_platform_per_day')
    ),
    'current', private.admin_figures(v_from, v_to),
    'previous', private.admin_figures(v_from - v_span, v_from),
    'weekly', (
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('week', g.week, 'meetings', coalesce(c.meetings, 0)) order by g.week)
      from pg_catalog.generate_series(
          pg_catalog.date_trunc('week', v_to at time zone 'UTC') - interval '11 weeks',
          pg_catalog.date_trunc('week', v_to at time zone 'UTC'), interval '1 week') as g(week)
      left join (
        select pg_catalog.date_trunc('week', m.sent_at at time zone 'UTC') as week, count(*) as meetings
        from public.meetings m
        where m.sent_at >= (pg_catalog.date_trunc('week', v_to at time zone 'UTC') - interval '11 weeks') at time zone 'UTC'
        group by 1
      ) c on c.week = g.week
    ),
    'health', pg_catalog.jsonb_build_object(
      'queue_waiting', (select count(*) from public.outbox_jobs j where j.status = 'pending' and j.run_after <= v_to),
      'queue_oldest', (select min(j.run_after) from public.outbox_jobs j where j.status = 'pending' and j.run_after <= v_to),
      'sheets_paused', (select count(*) from public.sheet_syncs s where s.status = 'paused'),
      'sheets_total', (select count(*) from public.sheet_syncs s),
      'senders_broken', (select count(*) from public.workspaces w join public.google_connections c on c.id = w.sender_connection_id where c.status = 'broken')
    )
  );
end;
$$;

create or replace function private.admin_workspace_rows(p_workspaces uuid[])
returns table (
  id uuid, name text, slug text, created_at timestamptz, owner_email text, owner_name text, team integer,
  contacts integer, meetings_30d integer, emails_30d integer, failed_30d integer, reports_7d integer,
  people_7d integer, suspended boolean, sender text, sheet text, has_sender boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with owners as (
    select r.workspace_id, lower(u.email) as email, p.display_name
    from public.workspace_roles r join auth.users u on u.id = r.user_id left join public.profiles p on p.user_id = r.user_id
    where r.role = 'owner' and r.workspace_id = any(p_workspaces)
  ),
  team as (
    select r.workspace_id, count(*)::integer as n from public.workspace_roles r
    where r.workspace_id = any(p_workspaces) group by 1
  ),
  people as (
    select c.workspace_id, count(*)::integer as n from public.contacts c
    where not c.is_adhoc and c.workspace_id = any(p_workspaces) group by 1
  ),
  meetings as (
    select m.workspace_id, count(*)::integer as n from public.meetings m
    where m.sent_at >= private.admin_period_start(30) and m.workspace_id = any(p_workspaces) group by 1
  ),
  emails as (
    select e.workspace_id, e.sent::integer as sent, e.failed::integer as failed
    from private.email_counts(private.admin_period_start(30), pg_catalog.now(), p_workspaces) e
  ),
  open_suspensions as (
    select s.workspace_id from public.workspace_sending_suspensions s
    where s.lifted_at is null and s.workspace_id = any(p_workspaces)
  )
  select w.id, w.name, w.slug, w.created_at, o.email, o.display_name, coalesce(t.n, 0), coalesce(pp.n, 0), coalesce(mt.n, 0),
    coalesce(e.sent, 0), coalesce(e.failed, 0), coalesce(rs.reporters, 0), coalesce(rs.people, 0),
    os.workspace_id is not null,
    case when c.id is null then 'none' when c.status = 'active' then 'active' else 'broken' end,
    case when s.workspace_id is null then 'off' when s.status = 'paused' then 'paused' else 'on' end,
    w.sender_connection_id is not null
  from public.workspaces w
  left join owners o on o.workspace_id = w.id
  left join team t on t.workspace_id = w.id
  left join people pp on pp.workspace_id = w.id
  left join meetings mt on mt.workspace_id = w.id
  left join emails e on e.workspace_id = w.id
  left join private.report_stats(p_workspaces) rs on rs.workspace_id = w.id
  left join open_suspensions os on os.workspace_id = w.id
  left join public.google_connections c on c.id = w.sender_connection_id
  left join public.sheet_syncs s on s.workspace_id = w.id
  where w.id = any(p_workspaces)
$$;

create or replace function private.admin_workspace(p_workspace uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  perform private.require_platform_role(false);
  select * into v_row from private.admin_workspace_rows(array[p_workspace]) r;
  if v_row.id is null then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  return pg_catalog.jsonb_build_object(
    'id', v_row.id, 'name', v_row.name, 'slug', v_row.slug, 'created_at', v_row.created_at,
    'owner_name', v_row.owner_name, 'owner_email', v_row.owner_email,
    'team', (select pg_catalog.jsonb_build_object(
        'owner', count(*) filter (where r.role = 'owner'), 'admin', count(*) filter (where r.role = 'admin'),
        'viewer', count(*) filter (where r.role = 'viewer'))
      from public.workspace_roles r where r.workspace_id = p_workspace),
    'contacts', v_row.contacts, 'sender', v_row.sender, 'sheet', v_row.sheet, 'suspended', v_row.suspended,
    'last_30', pg_catalog.jsonb_build_object(
      'meetings_sent', v_row.meetings_30d, 'emails_sent', v_row.emails_30d, 'emails_failed', v_row.failed_30d,
      'reports', (select count(*) from public.abuse_reports r where r.workspace_id = p_workspace and r.reported_at > private.admin_period_start(30)),
      'unsubscribes', (select count(*) from public.contacts c where c.workspace_id = p_workspace and c.unsubscribed_at > private.admin_period_start(30))),
    'reports_7d', v_row.reports_7d, 'people_7d', v_row.people_7d,
    'suspensions', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id', s.id, 'reason', s.reason, 'created_at', s.created_at, 'created_by_name', cp.display_name,
          'lifted_at', s.lifted_at, 'lifted_by_name', lp.display_name)
        order by s.created_at desc)
      from (select * from public.workspace_sending_suspensions x where x.workspace_id = p_workspace order by x.created_at desc limit 20) s
      left join public.profiles cp on cp.user_id = s.created_by
      left join public.profiles lp on lp.user_id = s.lifted_by), '[]'::jsonb)
  );
end;
$$;

-- Count the last 29 days now and record the mark, so the figures are whole before tonight's run.
select private.rollup_platform_daily();
