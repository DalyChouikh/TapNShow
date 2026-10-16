-- M9 (spec §6 platform_daily, §7.19, §8 Daily rollup): what the admin area reads.

alter table public.abuse_reports
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references auth.users (id) on delete set null;
create index abuse_reports_page_idx on public.abuse_reports (reported_at desc, id desc);
create index meetings_sent_at_idx on public.meetings (sent_at) where sent_at is not null;
create index outbox_jobs_failed_idx on public.outbox_jobs (updated_at) where status = 'failed';

-- Counts the database would otherwise lose after 30 days (send_log, finished jobs, push rows).
create table public.platform_daily (
  day date not null,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  emails_sent integer not null default 0,
  emails_failed integer not null default 0,
  people_emailed integer not null default 0,
  pushes_sent integer not null default 0,
  pushes_failed integer not null default 0,
  primary key (day, workspace_id)
);
create index platform_daily_workspace_idx on public.platform_daily (workspace_id, day);
alter table public.platform_daily enable row level security;
revoke all on table public.platform_daily from anon, authenticated;

-- Recomputes the email columns of the last 29 full UTC days (idempotent; push columns untouched).
create function private.rollup_platform_daily()
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
    set emails_sent = excluded.emails_sent, emails_failed = excluded.emails_failed, people_emailed = excluded.people_emailed
$$;
revoke execute on function private.rollup_platform_daily() from public, anon, authenticated;

-- One push counted on today's row of its workspace (push rows are deleted once handled). Only a
-- delivery this run still holds is counted, so a lost lease never counts twice.
create function private.count_push(p_delivery uuid, p_run uuid, p_sent boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.platform_daily (day, workspace_id, pushes_sent, pushes_failed)
  select (pg_catalog.now() at time zone 'UTC')::date, i.workspace_id, case when p_sent then 1 else 0 end, case when p_sent then 0 else 1 end
  from public.push_deliveries d join public.meeting_invitees i on i.id = d.invitee_id
  where d.id = p_delivery and d.run_id = p_run
  on conflict (day, workspace_id) do update
    set pushes_sent = public.platform_daily.pushes_sent + excluded.pushes_sent,
        pushes_failed = public.platform_daily.pushes_failed + excluded.pushes_failed
$$;
revoke execute on function private.count_push(uuid, uuid, boolean) from public, anon, authenticated;

-- Copied from 20261014160152_m8_push.sql; each counts its delivery first (spec §8 Daily rollup).
create or replace function private.push_done(p_delivery uuid, p_run uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subscription uuid;
begin
  perform private.count_push(p_delivery, p_run, true);
  delete from public.push_deliveries d where d.id = p_delivery and d.run_id = p_run
  returning d.subscription_id into v_subscription;
  if v_subscription is null then
    return false;
  end if;
  update public.push_subscriptions set last_success_at = pg_catalog.now() where id = v_subscription;
  return true;
end;
$$;

create or replace function private.push_drop(p_delivery uuid, p_run uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.count_push(p_delivery, p_run, false);
  delete from public.push_deliveries d where d.id = p_delivery and d.run_id = p_run
$$;

-- Copied from 20261014221206_m8_review_fixes.sql; the rollup runs first.
create or replace function private.housekeeping()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Before the 30-day purge below (spec §8 Daily rollup).
  perform private.rollup_platform_daily();
  delete from private.rate_limit_events e where e.occurred_at < pg_catalog.now() - interval '2 days';
  delete from public.outbox_jobs j where j.status in ('done', 'failed') and j.updated_at < pg_catalog.now() - interval '30 days';
  delete from public.send_log s where s.sent_at < pg_catalog.now() - interval '30 days';
  delete from public.sender_leases l where l.locked_until < pg_catalog.now() - interval '1 day';
  -- "+" creates a draft at once (grilling 2026-10-07); one left untitled and undated is litter.
  delete from public.meetings m
  where m.status = 'draft' and m.title = '' and m.starts_at is null and m.created_at < pg_catalog.now() - interval '24 hours';
  -- The current year of every sheet is redrawn once a day, so edits made in the sheet are repaired.
  perform private.sheet_mark(pg_catalog.array_agg(s.workspace_id), pg_catalog.array_agg(private.sheet_year(pg_catalog.now(), w.timezone)))
  from public.sheet_syncs s join public.workspaces w on w.id = s.workspace_id
  where s.spreadsheet_id is not null;
  -- Devices with no sign of life (no check-in, no notification received), and pushes nobody will
  -- send any more.
  delete from public.push_subscriptions s
  where s.last_active_at
    < pg_catalog.now() - pg_catalog.make_interval(days => private.app_limit('push_subscription_idle_days'));
  delete from public.push_deliveries d where d.created_at < pg_catalog.now() - interval '1 day';
end;
$$;

create function private.admin_figures(p_from timestamptz, p_to timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with today as (select ((pg_catalog.now() at time zone 'UTC')::date)::timestamp at time zone 'UTC' as start),
  rolled as (
    select coalesce(sum(d.emails_sent), 0) as sent, coalesce(sum(d.emails_failed), 0) as failed,
      coalesce(sum(d.pushes_sent), 0) as pushes_sent, coalesce(sum(d.pushes_failed), 0) as pushes_failed
    from public.platform_daily d
    where d.day >= (p_from at time zone 'UTC')::date and d.day <= (p_to at time zone 'UTC')::date
  ),
  live as (
    select
      (select count(*) from public.send_log l, today t where l.sent_at >= greatest(p_from, t.start) and l.sent_at < p_to) as sent,
      (select count(*) from public.outbox_jobs j, today t where j.status = 'failed' and j.invitee_id is not null
         and j.updated_at >= greatest(p_from, t.start) and j.updated_at < p_to) as failed
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
    'emails_sent', (select rolled.sent from rolled) + (select live.sent from live),
    'emails_failed', (select rolled.failed from rolled) + (select live.failed from live),
    'answers_rate_bp', (select case when a.invited = 0 then null else (a.answered * 10000 / a.invited) end from answered a),
    'accounts_total', (select count(*) from auth.users u where u.created_at < p_to),
    'accounts_new', (select count(*) from auth.users u where u.created_at >= p_from and u.created_at < p_to),
    'pushes_sent', (select rolled.pushes_sent from rolled),
    'pushes_failed', (select rolled.pushes_failed from rolled)
  )
$$;
revoke execute on function private.admin_figures(timestamptz, timestamptz) from public, anon, authenticated;

create function private.admin_overview(p_days integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_to timestamptz := pg_catalog.now();
  v_span interval;
begin
  perform private.require_platform_role(false);
  if p_days not in (7, 30, 90) then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  v_span := pg_catalog.make_interval(days => p_days);
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
    'current', private.admin_figures(v_to - v_span, v_to),
    'previous', private.admin_figures(v_to - 2 * v_span, v_to - v_span),
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

-- The suspension rule's two numbers per workspace (spec §7.12), in one place: distinct people who
-- reported it since the window opened and after its last lift, and distinct people it emailed in
-- the window. The trigger decides with them, and the admin area shows the same numbers.
create function private.report_stats(p_workspaces uuid[])
returns table (workspace_id uuid, reporters integer, people integer)
language sql
stable
security definer
set search_path = ''
as $$
  with win as (
    select pg_catalog.now() - pg_catalog.make_interval(days => private.app_limit('suspension_window_days')) as since
  ),
  ids as (
    select w.id, greatest(win.since, coalesce(max(s.lifted_at), '-infinity'::timestamptz)) as since
    from pg_catalog.unnest(p_workspaces) as w(id)
    cross join win
    left join public.workspace_sending_suspensions s on s.workspace_id = w.id
    group by w.id, win.since
  ),
  -- People, not rows: one person invited to several meetings can report from each invitation; a
  -- report whose contact was deleted since counts as its own person.
  reports as (
    select r.workspace_id, count(distinct coalesce(r.contact_id::text, r.id::text))::integer as n
    from public.abuse_reports r join ids on ids.id = r.workspace_id
    where r.reported_at > ids.since
    group by 1
  ),
  emailed as (
    select l.workspace_id, count(distinct i.contact_id)::integer as n
    from public.send_log l
    join public.outbox_jobs j on j.id = l.job_id
    join public.meeting_invitees i on i.id = j.invitee_id
    cross join win
    where l.workspace_id = any(p_workspaces) and l.sent_at > win.since
    group by 1
  )
  select ids.id, coalesce(r.n, 0), coalesce(e.n, 0)
  from ids
  left join reports r on r.workspace_id = ids.id
  left join emailed e on e.workspace_id = ids.id
$$;
revoke execute on function private.report_stats(uuid[]) from public, anon, authenticated;

-- Copied from 20261016015139_m9_suspension.sql; the counts come from private.report_stats.
create or replace function private.check_auto_suspension()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reports integer;
  v_people integer;
  v_facts jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('suspension:' || new.workspace_id::text));
  select s.reporters, s.people into v_reports, v_people from private.report_stats(array[new.workspace_id]) s;
  v_facts := pg_catalog.jsonb_build_object('reports', v_reports, 'people', v_people);
  perform private.record_platform_event('report', new.workspace_id, null, v_facts);
  if v_reports >= private.app_limit('suspension_reports_min')
     and v_reports * 10000 >= private.app_limit('suspension_report_rate_min_bp') * greatest(v_people, 1) then
    perform private.open_suspension(new.workspace_id, 'auto_reports', null, v_facts);
  end if;
  return null;
end;
$$;

-- Each workspace's health facts, for the given workspaces only (one grouped aggregate per table).
create function private.admin_workspace_rows(p_workspaces uuid[])
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
    where m.sent_at >= pg_catalog.now() - interval '30 days' and m.workspace_id = any(p_workspaces) group by 1
  ),
  emails as (
    select d.workspace_id, sum(d.emails_sent)::integer as sent, sum(d.emails_failed)::integer as failed
    from public.platform_daily d
    where d.day >= (pg_catalog.now() at time zone 'UTC')::date - 30 and d.workspace_id = any(p_workspaces) group by 1
  ),
  emails_today as (
    select l.workspace_id, count(*)::integer as sent from public.send_log l
    where l.sent_at >= ((pg_catalog.now() at time zone 'UTC')::date)::timestamp at time zone 'UTC'
      and l.workspace_id = any(p_workspaces) group by 1
  ),
  open_suspensions as (
    select s.workspace_id from public.workspace_sending_suspensions s
    where s.lifted_at is null and s.workspace_id = any(p_workspaces)
  )
  select w.id, w.name, w.slug, w.created_at, o.email, o.display_name, coalesce(t.n, 0), coalesce(pp.n, 0), coalesce(mt.n, 0),
    coalesce(e.sent, 0) + coalesce(et.sent, 0), coalesce(e.failed, 0), coalesce(rs.reporters, 0), coalesce(rs.people, 0),
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
  left join emails_today et on et.workspace_id = w.id
  left join private.report_stats(p_workspaces) rs on rs.workspace_id = w.id
  left join open_suspensions os on os.workspace_id = w.id
  left join public.google_connections c on c.id = w.sender_connection_id
  left join public.sheet_syncs s on s.workspace_id = w.id
  where w.id = any(p_workspaces)
$$;
revoke execute on function private.admin_workspace_rows(uuid[]) from public, anon, authenticated;

create function private.admin_workspaces(
  p_search text, p_filter text, p_sort text, p_after_value text, p_after_id uuid, p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := nullif(lower(btrim(coalesce(p_search, ''))), '');
begin
  perform private.require_platform_role(false);
  if p_filter not in ('all', 'suspended', 'reported', 'no_sender') or p_sort not in ('newest', 'reports', 'emails')
     or p_limit not between 1 and 101 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return pg_catalog.jsonb_build_object('items', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', x.id, 'name', x.name, 'slug', x.slug, 'created_at', x.created_at,
        'owner_email', private.mask_email(x.owner_email), 'team', x.team, 'contacts', x.contacts,
        'meetings_30d', x.meetings_30d, 'emails_30d', x.emails_30d, 'failed_30d', x.failed_30d,
        'reports_7d', x.reports_7d, 'people_7d', x.people_7d, 'suspended', x.suspended,
        'sender', x.sender, 'sheet', x.sheet, 'sort_value', x.sort_value)
      order by x.ord)
    from (
      select r.*, row_number() over (order by
          case when p_sort = 'newest' then r.created_at end desc,
          case when p_sort = 'reports' then r.reports_7d end desc,
          case when p_sort = 'emails' then r.emails_30d end desc,
          r.id desc) as ord,
        case p_sort when 'newest' then r.created_at::text when 'reports' then r.reports_7d::text else r.emails_30d::text end as sort_value
      from private.admin_workspace_rows((select pg_catalog.array_agg(w.id) from public.workspaces w)) r
      where (v_search is null or position(v_search in lower(r.name)) > 0 or position(v_search in coalesce(r.owner_email, '')) > 0)
        and (p_filter = 'all'
          or (p_filter = 'suspended' and r.suspended)
          or (p_filter = 'reported' and r.reports_7d > 0)
          or (p_filter = 'no_sender' and not r.has_sender))
        and (p_after_id is null or (
          case p_sort
            when 'newest' then (r.created_at, r.id) < (p_after_value::timestamptz, p_after_id)
            when 'reports' then (r.reports_7d, r.id) < (p_after_value::integer, p_after_id)
            else (r.emails_30d, r.id) < (p_after_value::integer, p_after_id)
          end))
      order by ord
      limit p_limit
    ) x), '[]'::jsonb));
end;
$$;

create function private.admin_workspace(p_workspace uuid)
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
      'reports', (select count(*) from public.abuse_reports r where r.workspace_id = p_workspace and r.reported_at > pg_catalog.now() - interval '30 days'),
      'unsubscribes', (select count(*) from public.contacts c where c.workspace_id = p_workspace and c.unsubscribed_at > pg_catalog.now() - interval '30 days')),
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

create function private.admin_reports(p_after_at timestamptz, p_after_id uuid, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_role(false);
  if p_limit not between 1 and 101 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return pg_catalog.jsonb_build_object('items', coalesce((
    with page as (
      select r.* from public.abuse_reports r
      where p_after_id is null or (r.reported_at, r.id) < (p_after_at, p_after_id)
      order by r.reported_at desc, r.id desc
      limit p_limit
    ), stats as (
      select x.workspace_id, x.reporters as reports_7d, x.people as people_7d
      from private.report_stats((select pg_catalog.array_agg(distinct page.workspace_id) from page)) x
    )
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', p.id, 'workspace_id', p.workspace_id, 'workspace_name', w.name, 'reported_at', p.reported_at,
        'reviewed_at', p.reviewed_at, 'reviewed_by_name', rp.display_name,
        'reports_7d', coalesce(s.reports_7d, 0), 'people_7d', coalesce(s.people_7d, 0))
      order by p.reported_at desc, p.id desc)
    from page p
    join public.workspaces w on w.id = p.workspace_id
    left join stats s on s.workspace_id = p.workspace_id
    left join public.profiles rp on rp.user_id = p.reviewed_by), '[]'::jsonb));
end;
$$;

create function private.admin_mark_reviewed(p_report uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
begin
  perform private.require_platform_role(false);
  update public.abuse_reports set reviewed_at = pg_catalog.now(), reviewed_by = auth.uid()
  where id = p_report and reviewed_at is null
  returning workspace_id into v_workspace;
  if v_workspace is not null then
    perform private.record_platform_event('report_reviewed', v_workspace, auth.uid(), '{}'::jsonb);
  end if;
end;
$$;

create function private.admin_log(p_filter text, p_after_id bigint, p_limit integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_role(false);
  if p_filter not in ('all', 'suspensions', 'admins') or p_limit not between 1 and 101 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return pg_catalog.jsonb_build_object('items', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', e.id, 'kind', e.kind, 'workspace_id', e.workspace_id, 'workspace_name', e.workspace_name,
        'actor_name', coalesce(p.display_name, case when e.actor_id is null then null else private.mask_email(lower(u.email)) end),
        'facts', e.facts, 'created_at', e.created_at)
      order by e.id desc)
    from (
      select * from public.platform_events x
      where (p_after_id is null or x.id < p_after_id)
        and (p_filter = 'all'
          or (p_filter = 'suspensions' and x.kind in ('auto_suspended', 'suspended', 'lifted'))
          or (p_filter = 'admins' and x.kind in ('admin_invited', 'admin_joined', 'admin_removed', 'invite_revoked', 'owner_set')))
      order by x.id desc
      limit p_limit
    ) e
    left join public.profiles p on p.user_id = e.actor_id
    left join auth.users u on u.id = e.actor_id), '[]'::jsonb));
end;
$$;

create function public.admin_overview(p_days integer) returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.admin_overview(p_days) $$;
create function public.admin_workspaces(p_search text, p_filter text, p_sort text, p_after_value text, p_after_id uuid, p_limit integer)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.admin_workspaces(p_search, p_filter, p_sort, p_after_value, p_after_id, p_limit) $$;
create function public.admin_workspace(p_workspace uuid) returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.admin_workspace(p_workspace) $$;
create function public.admin_reports(p_after_at timestamptz, p_after_id uuid, p_limit integer) returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.admin_reports(p_after_at, p_after_id, p_limit) $$;
create function public.admin_mark_reviewed(p_report uuid) returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('admin_write'); select private.admin_mark_reviewed(p_report) $$;
create function public.admin_log(p_filter text, p_after_id bigint, p_limit integer) returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.admin_log(p_filter, p_after_id, p_limit) $$;

revoke execute on function
  private.admin_overview(integer), private.admin_workspaces(text, text, text, text, uuid, integer),
  private.admin_workspace(uuid), private.admin_reports(timestamptz, uuid, integer), private.admin_mark_reviewed(uuid),
  private.admin_log(text, bigint, integer),
  public.admin_overview(integer), public.admin_workspaces(text, text, text, text, uuid, integer),
  public.admin_workspace(uuid), public.admin_reports(timestamptz, uuid, integer), public.admin_mark_reviewed(uuid),
  public.admin_log(text, bigint, integer)
from public, anon;
grant execute on function
  private.admin_overview(integer), private.admin_workspaces(text, text, text, text, uuid, integer),
  private.admin_workspace(uuid), private.admin_reports(timestamptz, uuid, integer), private.admin_mark_reviewed(uuid),
  private.admin_log(text, bigint, integer),
  public.admin_overview(integer), public.admin_workspaces(text, text, text, text, uuid, integer),
  public.admin_workspace(uuid), public.admin_reports(timestamptz, uuid, integer), public.admin_mark_reviewed(uuid),
  public.admin_log(text, bigint, integer)
to authenticated;
