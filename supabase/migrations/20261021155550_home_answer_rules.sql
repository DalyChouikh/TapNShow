-- Workspace Home minors (#417, items 7 and 8).

-- 7. "Answered before the start" is strictly before it, as on Home (workspace_insights, newest in
-- 20261018111205_attendance_at_caps.sql): an answer given at the start came once the meeting had
-- started. The admin overview's rollup and live count used <=. Copied from
-- 20261016234455_m9_overview_review.sql (the newest definitions); same signatures, so the grants
-- stay. The pair is pinned by m9-admin-reads.db.test.ts.
create or replace function private.rollup_answers(p_first date, p_before date)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.platform_daily d set invited = 0, answered = 0
  where d.day >= p_first and d.day < p_before and (d.invited <> 0 or d.answered <> 0);
  insert into public.platform_daily (day, workspace_id, invited, answered)
  select (m.starts_at at time zone 'UTC')::date, m.workspace_id, count(*),
    count(r.id) filter (where r.responded_at < m.starts_at)
  from public.meetings m
  join public.meeting_invitees i on i.meeting_id = m.id and i.email_status = 'sent'
  left join public.responses r on r.invitee_id = i.id
  where m.response_mode <> 'announcement' and m.status = 'scheduled'
    and m.starts_at >= p_first::timestamp at time zone 'UTC'
    and m.starts_at < p_before::timestamp at time zone 'UTC'
  group by 1, 2
  on conflict (day, workspace_id) do update set invited = excluded.invited, answered = excluded.answered;
$$;

create or replace function private.answer_counts(p_from timestamptz, p_to timestamptz)
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
      select count(*) as invited, count(r.id) filter (where r.responded_at < m.starts_at) as answered
      from public.meeting_invitees i
      left join public.responses r on r.invitee_id = i.id
      where i.meeting_id = m.id and i.email_status = 'sent'
    ) x
    where m.response_mode <> 'announcement' and m.status = 'scheduled'
  )
  select r.invited + l.invited, r.answered + l.answered from rolled r, live l
$$;

-- The days already rolled up counted the answers given exactly at the start: take those out. Only
-- they change (`responded_at` is written once, by the first answer), so every other stored count
-- stays as it is; none existed in production or preview when this was written.
with at_start as (
  select (m.starts_at at time zone 'UTC')::date as day, m.workspace_id, count(*) as answers
  from public.meetings m
  join public.meeting_invitees i on i.meeting_id = m.id and i.email_status = 'sent'
  join public.responses r on r.invitee_id = i.id and r.responded_at = m.starts_at
  where m.response_mode <> 'announcement' and m.status = 'scheduled'
    and m.starts_at < ((select s.rolled_through from public.platform_rollup_state s) + 1)::timestamp at time zone 'UTC'
  group by 1, 2
)
update public.platform_daily d set answered = d.answered - a.answers
from at_start a
where d.day = a.day and d.workspace_id = a.workspace_id;

-- 8. An answer and a check-in belong to their invitee's meeting and workspace. Home's insights and
-- Lists read each meeting's answers and check-ins by (meeting, workspace, invitee) from the covering
-- indexes (20261017164123_home_insights.sql), so a row filed under another meeting would count
-- there. Foreign keys to the invitee's (meeting, workspace, id) enforce it, on insert and update.
-- They need a unique key on those columns: the invitees' covering index becomes one, with the same
-- name, columns and included columns, so the readers' plans and the plan tests stay (id alone is
-- unique, so the key is too).
drop index public.meeting_invitees_meeting_ws_idx;
alter table public.meeting_invitees
  add constraint meeting_invitees_meeting_ws_idx unique (meeting_id, workspace_id, id)
  include (contact_id, email_status);

alter table public.responses
  add constraint responses_invitee_meeting_fkey foreign key (meeting_id, workspace_id, invitee_id)
  references public.meeting_invitees (meeting_id, workspace_id, id) on delete cascade;
alter table public.attendance_marks
  add constraint attendance_marks_invitee_meeting_fkey foreign key (meeting_id, workspace_id, invitee_id)
  references public.meeting_invitees (meeting_id, workspace_id, id) on delete cascade;
