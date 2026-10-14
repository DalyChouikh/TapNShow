-- M8 member reads (spec §6 Identity rules and Access pattern (M8), §7.4, §10 Members API).
-- Invites are matched to accounts by verified email when read, so the never-filled link column
-- goes (owner, 2026-10-14: remove what is unused).

alter table public.contacts drop column user_id;  -- drops contacts_user_id_idx with it
create index contacts_email_idx on public.contacts (email);

insert into private.app_limits (name, value) values
  ('invite_links_per_user_per_hour', 600),
  ('answer_downloads_per_user_per_hour', 600),
  ('account_deletions_per_user_per_hour', 5),
  ('push_subscribes_per_user_per_hour', 30);

-- Latest body from 20261011134035_m7_minors_hardening.sql, plus the four M8 actions.
create or replace function private.hit_user_rate_limit(p_action text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_limit_name text := case p_action
    when 'import' then 'imports_per_user_per_hour'
    when 'import_preview' then 'import_previews_per_user_per_hour'
    when 'contact_add' then 'contact_adds_per_user_per_hour'
    when 'meeting_create' then 'meetings_per_user_per_hour'
    when 'meeting_people_add' then 'meeting_people_adds_per_user_per_hour'
    when 'meeting_edit_email' then 'meeting_email_edits_per_user_per_hour'
    when 'sheet_retry' then 'sheet_retries_per_user_per_hour'
    when 'google_connect' then 'google_connects_per_user_per_hour'
    when 'check_in_mark' then 'check_in_marks_per_user_per_hour'
    when 'check_in_rest' then 'check_in_rests_per_user_per_hour'
    when 'invite_link' then 'invite_links_per_user_per_hour'
    when 'answers_download' then 'answer_downloads_per_user_per_hour'
    when 'account_delete' then 'account_deletions_per_user_per_hour'
    when 'push_subscribe' then 'push_subscribes_per_user_per_hour'
  end;
begin
  if v_user is null or v_limit_name is null then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return private.hit_rate_limit(p_action || ':user:' || v_user::text, private.app_limit(v_limit_name), interval '1 hour');
end;
$$;

-- THE matching rule: a contact belongs to an account when its email equals the account's
-- confirmed email (spec §6). Auth stores emails lower-cased, like contacts, so the plain equality
-- uses contacts_email_idx. Twin, the other way round (contact → accounts): private.push_enqueue.
-- A function with its own search_path is never inlined, so `rows` tells the planner the truth
-- (one contact per workspace the person is in); the default 1,000 made callers hash every invitee.
create function private.contacts_of(p_user uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
rows 3
as $$
  select c.id
  from auth.users u
  join public.contacts c on c.email = u.email
  where u.id = p_user and u.email_confirmed_at is not null
$$;

-- The caller's invites whose email went out (only those have a working answer link). Driven from
-- the caller's few contacts through meeting_invitees_contact_ws_idx; `rows` as in contacts_of.
create function private.my_invitees()
returns table (invitee_id uuid, workspace_id uuid, meeting_id uuid, contact_id uuid)
language sql
stable
security definer
set search_path = ''
rows 100
as $$
  select i.id, i.workspace_id, i.meeting_id, i.contact_id
  from private.contacts_of(auth.uid()) c (id)
  join public.meeting_invitees i on i.contact_id = c.id
  where i.token_hash is not null
$$;

-- One page of /invites (spec §7.4). Upcoming: start ascending; Past: start descending; keyset on
-- (starts_at, invitee_id). "Needs your answer": asks for answers, not cancelled, not started, and
-- no answer yet or to reconfirm. as_of is the server's time, shown when the page is read offline.
create function private.my_invites(
  p_tab text, p_filter text, p_after_starts timestamptz, p_after_invitee uuid, p_limit integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_upcoming boolean := p_tab = 'upcoming';
  v_now timestamptz := pg_catalog.now();
begin
  if p_tab is null or p_tab not in ('upcoming', 'past')
    or p_filter is null or p_filter not in ('all', 'needs')
    or (p_filter = 'needs' and not v_upcoming)
    or p_limit is null or p_limit not between 1 and 100
    or ((p_after_starts is null) <> (p_after_invitee is null)) then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return (
    with mine as materialized (
      select x.invitee_id, w.name as workspace_name, m.title, m.starts_at, m.timezone, m.duration_minutes,
        m.status, m.response_mode, m.response_deadline,
        r.id is not null as answered, r.status as answer_status, r.delay_minutes, r.reason,
        coalesce(r.needs_reconfirmation, false) as needs_reconfirmation,
        am.actual, am.late_minutes,
        (m.response_mode <> 'announcement' and m.status = 'scheduled' and m.starts_at > v_now
          and (r.id is null or r.needs_reconfirmation)) as needs_answer
      from private.my_invitees() x
      join public.meetings m on m.id = x.meeting_id
      join public.workspaces w on w.id = x.workspace_id
      left join public.responses r on r.invitee_id = x.invitee_id
      left join public.attendance_marks am on am.invitee_id = x.invitee_id
      where m.starts_at is not null
    ), page as (
      select mine.* from mine
      where (case when v_upcoming then mine.starts_at > v_now else mine.starts_at <= v_now end)
        and (p_filter = 'all' or mine.needs_answer)
        and (p_after_invitee is null
          or (v_upcoming and (mine.starts_at, mine.invitee_id) > (p_after_starts, p_after_invitee))
          or (not v_upcoming and (mine.starts_at, mine.invitee_id) < (p_after_starts, p_after_invitee)))
      order by
        case when v_upcoming then mine.starts_at end, case when v_upcoming then mine.invitee_id end,
        case when not v_upcoming then mine.starts_at end desc, case when not v_upcoming then mine.invitee_id end desc
      limit p_limit + 1
    ), numbered as (
      select page.*, row_number() over (order by
        case when v_upcoming then page.starts_at end, case when v_upcoming then page.invitee_id end,
        case when not v_upcoming then page.starts_at end desc,
        case when not v_upcoming then page.invitee_id end desc) as n
      from page
    )
    select pg_catalog.jsonb_build_object(
      'has_more', (select count(*) > p_limit from page),
      'needs_count', (select count(*) from mine where mine.needs_answer),
      'as_of', v_now,
      'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'invitee_id', numbered.invitee_id, 'workspace_name', numbered.workspace_name,
          'title', numbered.title, 'starts_at', numbered.starts_at, 'timezone', numbered.timezone,
          'duration_minutes', numbered.duration_minutes, 'status', numbered.status,
          'response_mode', numbered.response_mode, 'response_deadline', numbered.response_deadline,
          'needs_answer', numbered.needs_answer,
          'answer', case when numbered.answered then pg_catalog.jsonb_build_object(
            'status', numbered.answer_status, 'delay_minutes', numbered.delay_minutes,
            'reason', numbered.reason, 'needs_reconfirmation', numbered.needs_reconfirmation) end,
          'mark', case when numbered.actual is not null then pg_catalog.jsonb_build_object(
            'actual', numbered.actual, 'late_minutes', numbered.late_minutes) end)
          order by numbered.n)
        from numbered where numbered.n <= p_limit), '[]'::jsonb)
    )
  );
end;
$$;

-- The invite /invites/[id] and a notification open, if it is the caller's (rate limited: the
-- route derives a personal link from it).
create function private.my_invite(p_invitee uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.hit_user_rate_limit('invite_link') then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;
  select x.invitee_id into v_id from private.my_invitees() x where x.invitee_id = p_invitee;
  if v_id is null then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  return v_id;
end;
$$;

-- Download my answers (spec §7.4): every listed invite, newest first, one page per call.
create function private.my_answers(p_after_starts timestamptz, p_after_invitee uuid, p_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit not between 1 and 100
    or ((p_after_starts is null) <> (p_after_invitee is null)) then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if not private.hit_user_rate_limit('answers_download') then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;
  return (
    with page as (
      select x.invitee_id, w.name as workspace_name, m.title, m.starts_at, m.timezone, m.response_mode,
        m.status, r.id as response_id, r.status as answer_status, r.delay_minutes, r.reason, r.comment,
        r.after_deadline, r.updated_at, am.actual, am.late_minutes
      from private.my_invitees() x
      join public.meetings m on m.id = x.meeting_id
      join public.workspaces w on w.id = x.workspace_id
      left join public.responses r on r.invitee_id = x.invitee_id
      left join public.attendance_marks am on am.invitee_id = x.invitee_id
      where m.starts_at is not null
        and (p_after_invitee is null or (m.starts_at, x.invitee_id) < (p_after_starts, p_after_invitee))
      order by m.starts_at desc, x.invitee_id desc
      limit p_limit + 1
    ), numbered as (
      select page.*, row_number() over (order by page.starts_at desc, page.invitee_id desc) as n from page
    )
    select pg_catalog.jsonb_build_object(
      'has_more', (select count(*) > p_limit from page),
      'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'invitee_id', numbered.invitee_id, 'workspace_name', numbered.workspace_name,
          'title', numbered.title, 'starts_at', numbered.starts_at, 'timezone', numbered.timezone,
          'response_mode', numbered.response_mode, 'status', numbered.status,
          'answer', case when numbered.response_id is not null then pg_catalog.jsonb_build_object(
            'status', numbered.answer_status, 'delay_minutes', numbered.delay_minutes,
            'reason', numbered.reason, 'comment', numbered.comment,
            'after_deadline', numbered.after_deadline, 'updated_at', numbered.updated_at) end,
          'mark', case when numbered.actual is not null then pg_catalog.jsonb_build_object(
            'actual', numbered.actual, 'late_minutes', numbered.late_minutes) end)
          order by numbered.n)
        from numbered where numbered.n <= p_limit), '[]'::jsonb)
    )
  );
end;
$$;

-- What /account and its delete dialog say (spec §7.4).
create function private.my_account()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'owned', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', w.name, 'slug', w.slug) order by w.name)
      from public.workspace_roles r join public.workspaces w on w.id = r.workspace_id
      where r.user_id = auth.uid() and r.role = 'owner'), '[]'::jsonb),
    'workspaces', (select count(*) from public.workspace_roles r where r.user_id = auth.uid()),
    'answers_with_text', (
      select count(*) from private.my_invitees() x
      join public.responses r on r.invitee_id = x.invitee_id
      where r.reason <> '' or r.comment <> '')
  )
$$;

-- The answer page's viewer (spec §10): 'owner' when the signed-in account (checked by the route
-- from the session) is the invite's own verified address.
create function private.token_viewer(p_token_hash text, p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (
    select 1 from public.meeting_invitees i
    where i.token_hash = p_token_hash and i.contact_id in (select private.contacts_of(p_user))
  ) then 'owner' else 'other' end
$$;

create function public.my_invites(
  p_tab text, p_filter text, p_after_starts timestamptz, p_after_invitee uuid, p_limit integer
)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.my_invites(p_tab, p_filter, p_after_starts, p_after_invitee, p_limit) $$;
create function public.my_invite(p_invitee uuid)
returns uuid language sql security invoker set search_path = ''
as $$ select private.my_invite(p_invitee) $$;
create function public.my_answers(p_after_starts timestamptz, p_after_invitee uuid, p_limit integer)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.my_answers(p_after_starts, p_after_invitee, p_limit) $$;
create function public.my_account()
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.my_account() $$;
create function public.token_viewer(p_token_hash text, p_user uuid)
returns text language sql stable security invoker set search_path = ''
as $$ select private.token_viewer(p_token_hash, p_user) $$;

revoke execute on function private.contacts_of(uuid), private.my_invitees() from public, anon, authenticated;
grant execute on function
  private.my_invites(text, text, timestamptz, uuid, integer), private.my_invite(uuid),
  private.my_answers(timestamptz, uuid, integer), private.my_account()
to authenticated;
revoke execute on function
  private.my_invites(text, text, timestamptz, uuid, integer), private.my_invite(uuid),
  private.my_answers(timestamptz, uuid, integer), private.my_account(), private.token_viewer(text, uuid)
from public, anon;
revoke execute on function private.token_viewer(text, uuid) from authenticated;
grant execute on function private.token_viewer(text, uuid) to service_role;
revoke execute on function
  public.my_invites(text, text, timestamptz, uuid, integer), public.my_invite(uuid),
  public.my_answers(timestamptz, uuid, integer), public.my_account(), public.token_viewer(text, uuid)
from public, anon;
grant execute on function
  public.my_invites(text, text, timestamptz, uuid, integer), public.my_invite(uuid),
  public.my_answers(timestamptz, uuid, integer), public.my_account()
to authenticated;
revoke execute on function public.token_viewer(text, uuid) from authenticated;
grant execute on function public.token_viewer(text, uuid) to service_role;
