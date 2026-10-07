-- M4 meetings (spec §6 Meetings + contacts, §7.2).

insert into private.app_limits (name, value) values
  ('meetings_per_user_per_hour', 30),
  ('meeting_people_adds_per_user_per_hour', 120),
  ('invitees_per_meeting_max', 500),
  ('meeting_people_per_call_max', 50);

create type public.meeting_status as enum ('draft', 'scheduled', 'cancelled');
create type public.audience_mode as enum ('include', 'exclude');
create type public.invitee_email_status as enum ('queued', 'sent', 'skipped', 'failed', 'unknown');
create type public.unsubscribe_via as enum ('link', 'report');

alter table public.contacts
  add column unsubscribed_via public.unsubscribe_via,
  add constraint contacts_unsubscribe_pair check ((unsubscribed_at is null) = (unsubscribed_via is null));

-- A one-off guest may join the roster (import, "Save to roster"); a roster contact never becomes a
-- hidden guest (that would also slip past the contacts cap, which counts roster contacts only).
create function private.guard_adhoc_flag()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_adhoc and not old.is_adhoc then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  -- A guest joining the roster counts like an insert; the insert-time cap trigger never sees it
  -- (security review: create guests, then flip them, would bypass the contacts cap).
  if old.is_adhoc and not new.is_adhoc then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('roster:contacts:' || new.workspace_id::text));
    if (select count(*) from public.contacts c where c.workspace_id = new.workspace_id and not c.is_adhoc)
        >= private.app_limit('contacts_per_workspace_max') then
      raise exception 'tn:contacts_limit_reached' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;
create trigger contacts_guard_adhoc
  before update of is_adhoc on public.contacts
  for each row execute function private.guard_adhoc_flag();
grant update (is_adhoc) on table public.contacts to authenticated;

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null default '' check (title = btrim(title) and char_length(title) <= 120),
  agenda_md text not null default '' check (char_length(agenda_md) <= 5000),
  starts_at timestamptz,
  duration_minutes smallint not null check (duration_minutes between 5 and 720),
  timezone text not null,
  location_mode public.location_mode not null default 'in_person',
  location_text text not null default '' check (location_text = btrim(location_text) and char_length(location_text) <= 200),
  meeting_url text not null default ''
    check (meeting_url = '' or (meeting_url ~ '^https?://[^[:space:]]+$' and char_length(meeting_url) <= 500)),
  response_mode public.response_mode not null,
  response_deadline timestamptz,
  delay_options smallint[] not null default '{}' check (private.valid_delay_options(delay_options)),
  reason_required boolean not null,
  comments_enabled boolean not null,
  footer_note text not null default '' check (footer_note = btrim(footer_note) and char_length(footer_note) <= 280),
  status public.meeting_status not null default 'draft',
  sent_at timestamptz,
  ics_uid text not null unique default (gen_random_uuid()::text || '@tapnshow.vercel.app'),
  ics_sequence integer not null default 0,
  gmail_thread_id text,
  gmail_root_message_id text,
  thread_connection_id uuid references public.google_connections (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id)
);
create index meetings_workspace_starts_idx on public.meetings (workspace_id, starts_at);
create index meetings_thread_connection_idx on public.meetings (thread_connection_id);
create index meetings_created_by_idx on public.meetings (created_by);
create trigger meetings_set_updated_at
  before update on public.meetings
  for each row execute function private.set_updated_at();
create trigger meetings_validate_timezone
  before insert or update of timezone on public.meetings
  for each row execute function private.validate_workspace_timezone();

create table public.meeting_audience (
  workspace_id uuid not null,
  meeting_id uuid not null,
  list_id uuid not null,
  primary key (meeting_id, list_id),
  foreign key (meeting_id, workspace_id) references public.meetings (id, workspace_id) on delete cascade,
  foreign key (list_id, workspace_id) references public.lists (id, workspace_id) on delete cascade
);
create index meeting_audience_meeting_ws_idx on public.meeting_audience (meeting_id, workspace_id);
create index meeting_audience_list_ws_idx on public.meeting_audience (list_id, workspace_id);

create table public.meeting_audience_people (
  workspace_id uuid not null,
  meeting_id uuid not null,
  contact_id uuid not null,
  mode public.audience_mode not null,
  primary key (meeting_id, contact_id),
  foreign key (meeting_id, workspace_id) references public.meetings (id, workspace_id) on delete cascade,
  foreign key (contact_id, workspace_id) references public.contacts (id, workspace_id) on delete cascade
);
create index meeting_audience_people_meeting_ws_idx on public.meeting_audience_people (meeting_id, workspace_id);
create index meeting_audience_people_contact_ws_idx on public.meeting_audience_people (contact_id, workspace_id);

create table public.meeting_invitees (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  meeting_id uuid not null,
  contact_id uuid not null,
  token_hash text unique,
  invited_at timestamptz not null default now(),
  email_status public.invitee_email_status not null default 'queued',
  email_error text check (email_error is null or char_length(email_error) <= 300),
  sent_at timestamptz,
  unique (meeting_id, contact_id),
  foreign key (meeting_id, workspace_id) references public.meetings (id, workspace_id) on delete cascade,
  foreign key (contact_id, workspace_id) references public.contacts (id, workspace_id) on delete cascade
);
create index meeting_invitees_meeting_ws_idx on public.meeting_invitees (meeting_id, workspace_id);
create index meeting_invitees_contact_ws_idx on public.meeting_invitees (contact_id, workspace_id);

alter table public.meetings enable row level security;
alter table public.meeting_audience enable row level security;
alter table public.meeting_audience_people enable row level security;
alter table public.meeting_invitees enable row level security;
revoke all on table public.meetings, public.meeting_audience, public.meeting_audience_people, public.meeting_invitees
  from anon, authenticated;
grant select on table public.meetings, public.meeting_audience, public.meeting_audience_people, public.meeting_invitees
  to authenticated;
-- No direct inserts: create_meeting (definer) applies the hourly limit (security review).
grant update (title, agenda_md, starts_at, duration_minutes, timezone, location_mode, location_text, meeting_url,
              response_mode, response_deadline, delay_options, reason_required, comments_enabled, footer_note),
      delete
  on table public.meetings to authenticated;
-- Audience rows are written only by set_meeting_audience / add_meeting_people (definer), which
-- enforce the per-meeting cap (security review).
grant all on table public.meetings, public.meeting_audience, public.meeting_audience_people, public.meeting_invitees
  to service_role;

create policy meetings_select_members on public.meetings
  for select to authenticated using (private.is_member(workspace_id));
create policy meetings_update_drafts on public.meetings
  for update to authenticated
  using (status = 'draft' and private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[]))
  with check (status = 'draft' and private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));
create policy meetings_delete_drafts on public.meetings
  for delete to authenticated
  using (status = 'draft' and private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));

create policy meeting_audience_select_members on public.meeting_audience
  for select to authenticated using (private.is_member(workspace_id));
create policy meeting_audience_people_select_members on public.meeting_audience_people
  for select to authenticated using (private.is_member(workspace_id));
create policy meeting_invitees_select_members on public.meeting_invitees
  for select to authenticated using (private.is_member(workspace_id));

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
  end;
begin
  if v_user is null or v_limit_name is null then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return private.hit_rate_limit(p_action || ':user:' || v_user::text, private.app_limit(v_limit_name), interval '1 hour');
end;
$$;

-- The one definition of "who is in this meeting's audience" (spec §7.2): people in a picked list,
-- individually included, individually excluded, or already invited. Runs with the caller's rights.
create function private.audience_members(p_meeting uuid)
returns table (
  contact_id uuid,
  mode public.audience_mode,
  list_ids uuid[],
  unsubscribed boolean,
  reported boolean,
  invited boolean
)
language sql
stable
set search_path = ''
as $$
  select x.contact_id, x.mode, x.list_ids, x.unsubscribed, x.reported, x.invited
  from (
    select c.id as contact_id,
      p.mode,
      coalesce((
        select array_agg(lc.list_id order by lc.list_id)
        from public.list_contacts lc
        join public.meeting_audience a on a.list_id = lc.list_id and a.meeting_id = p_meeting
        where lc.contact_id = c.id
      ), '{}') as list_ids,
      c.unsubscribed_at is not null as unsubscribed,
      c.unsubscribed_via is not distinct from 'report' as reported,
      i.id is not null as invited
    from public.meetings m
    join public.contacts c on c.workspace_id = m.workspace_id
    left join public.meeting_audience_people p on p.meeting_id = m.id and p.contact_id = c.id
    left join public.meeting_invitees i on i.meeting_id = m.id and i.contact_id = c.id
    where m.id = p_meeting
  ) x
  where x.mode is not null or x.list_ids <> '{}' or x.invited;
$$;

create function private.create_meeting(p_workspace uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_member(p_workspace, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if not private.hit_user_rate_limit('meeting_create') then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;
  insert into public.meetings (
    workspace_id, duration_minutes, timezone, response_mode, delay_options, reason_required,
    comments_enabled, footer_note, created_by
  )
  select w.id, w.default_duration_minutes, w.timezone, w.default_response_mode, w.default_delay_options,
    w.default_reason_required, w.default_comments_enabled, w.default_footer_note, auth.uid()
  from public.workspaces w
  where w.id = p_workspace
  returning id into v_id;
  return v_id;
end;
$$;

create function private.set_meeting_audience(p_meeting uuid, p_list_ids uuid[], p_include uuid[], p_exclude uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_status public.meeting_status;
  v_lists uuid[] := coalesce(p_list_ids, '{}');
  v_include uuid[] := coalesce(p_include, '{}');
  v_exclude uuid[] := coalesce(p_exclude, '{}');
begin
  select m.workspace_id, m.status into v_workspace, v_status from public.meetings m where m.id = p_meeting;
  if v_workspace is null or not private.is_member(v_workspace) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if not private.is_member(v_workspace, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if v_status not in ('draft', 'scheduled') then
    raise exception 'tn:meeting_not_draft' using errcode = 'P0001';
  end if;
  if v_include && v_exclude then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if pg_catalog.cardinality(v_include) > private.app_limit('invitees_per_meeting_max') then
    raise exception 'tn:too_many_invitees' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from pg_catalog.unnest(v_lists) as x(id)
    where not exists (select 1 from public.lists l where l.id = x.id and l.workspace_id = v_workspace)
  ) or exists (
    select 1 from pg_catalog.unnest(v_include || v_exclude) as x(id)
    where not exists (select 1 from public.contacts c where c.id = x.id and c.workspace_id = v_workspace)
  ) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  delete from public.meeting_audience a where a.meeting_id = p_meeting and a.list_id <> all (v_lists);
  insert into public.meeting_audience (workspace_id, meeting_id, list_id)
  select v_workspace, p_meeting, x.id from pg_catalog.unnest(v_lists) as x(id)
  on conflict do nothing;
  delete from public.meeting_audience_people p where p.meeting_id = p_meeting;
  insert into public.meeting_audience_people (workspace_id, meeting_id, contact_id, mode)
  select distinct v_workspace, p_meeting, x.id, 'include'::public.audience_mode from pg_catalog.unnest(v_include) as x(id)
  union
  select distinct v_workspace, p_meeting, x.id, 'exclude'::public.audience_mode from pg_catalog.unnest(v_exclude) as x(id);
end;
$$;

create function private.add_meeting_people(p_meeting uuid, p_people jsonb, p_save_to_roster boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_status public.meeting_status;
  v_ids uuid[];
begin
  select m.workspace_id, m.status into v_workspace, v_status from public.meetings m where m.id = p_meeting;
  if v_workspace is null or not private.is_member(v_workspace) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if not private.is_member(v_workspace, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if v_status not in ('draft', 'scheduled') then
    raise exception 'tn:meeting_not_draft' using errcode = 'P0001';
  end if;
  if p_people is null or pg_catalog.jsonb_typeof(p_people) <> 'array'
    or pg_catalog.jsonb_array_length(p_people) = 0
    or pg_catalog.jsonb_array_length(p_people) > private.app_limit('meeting_people_per_call_max')
    or exists (
      select 1 from pg_catalog.jsonb_array_elements(p_people) p
      where not private.is_valid_email(lower(btrim(coalesce(p ->> 'email', ''))))
        or char_length(btrim(regexp_replace(coalesce(p ->> 'full_name', ''), '[[:space:]]+', ' ', 'g'))) not between 1 and 120
    ) then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if not private.hit_user_rate_limit('meeting_people_add') then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;

  -- Same email twice in one call: the last name wins (as in import_contacts).
  insert into public.contacts (workspace_id, email, full_name, is_adhoc)
  select distinct on (i.email) v_workspace, i.email, i.full_name, not p_save_to_roster
  from (
    select lower(btrim(p ->> 'email')) as email,
      btrim(regexp_replace(p ->> 'full_name', '[[:space:]]+', ' ', 'g')) as full_name,
      ord
    from pg_catalog.jsonb_array_elements(p_people) with ordinality as x(p, ord)
  ) i
  order by i.email, i.ord desc
  on conflict (workspace_id, email) do update
    set is_adhoc = false
    where p_save_to_roster and public.contacts.is_adhoc;

  select array_agg(c.id order by c.email) into v_ids
  from public.contacts c
  where c.workspace_id = v_workspace
    and c.email in (select lower(btrim(p ->> 'email')) from pg_catalog.jsonb_array_elements(p_people) p);

  insert into public.meeting_audience_people (workspace_id, meeting_id, contact_id, mode)
  select v_workspace, p_meeting, x.id, 'include' from pg_catalog.unnest(v_ids) as x(id)
  on conflict (meeting_id, contact_id) do update set mode = 'include';

  -- Guests moved into the roster by an update skip the insert-time cap trigger; check here.
  if (select count(*) from public.contacts c where c.workspace_id = v_workspace and not c.is_adhoc)
      > private.app_limit('contacts_per_workspace_max') then
    raise exception 'tn:contacts_limit_reached' using errcode = 'P0001';
  end if;
  if (select count(*) from public.meeting_audience_people p where p.meeting_id = p_meeting and p.mode = 'include')
      > private.app_limit('invitees_per_meeting_max') then
    raise exception 'tn:too_many_invitees' using errcode = 'P0001';
  end if;
  return pg_catalog.jsonb_build_object('contact_ids', pg_catalog.to_jsonb(v_ids));
end;
$$;

create function public.create_meeting(p_workspace uuid)
returns uuid language sql security invoker set search_path = ''
as $$ select private.create_meeting(p_workspace) $$;

create function public.set_meeting_audience(p_meeting uuid, p_list_ids uuid[], p_include uuid[], p_exclude uuid[])
returns void language sql security invoker set search_path = ''
as $$ select private.set_meeting_audience(p_meeting, p_list_ids, p_include, p_exclude) $$;

create function public.add_meeting_people(p_meeting uuid, p_people jsonb, p_save_to_roster boolean)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.add_meeting_people(p_meeting, p_people, p_save_to_roster) $$;

create function public.meeting_audience(p_meeting uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_result jsonb;
begin
  select m.workspace_id into v_workspace from public.meetings m where m.id = p_meeting;
  if v_workspace is null then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  select pg_catalog.jsonb_build_object(
    'list_ids', coalesce((
      select pg_catalog.jsonb_agg(a.list_id order by a.list_id) from public.meeting_audience a where a.meeting_id = p_meeting
    ), '[]'::jsonb),
    'people', coalesce(pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', c.id,
        'full_name', c.full_name,
        'email', c.email,
        'list_ids', pg_catalog.to_jsonb(am.list_ids),
        'added', am.mode is not distinct from 'include',
        'excluded', am.mode is not distinct from 'exclude',
        'unsubscribed', am.unsubscribed,
        'reported', am.reported,
        'invited', am.invited
      )
      order by lower(c.full_name), c.email
    ) filter (where c.id is not null), '[]'::jsonb),
    'counts', pg_catalog.jsonb_build_object(
      'selected', count(*) filter (where c.id is not null and am.mode is distinct from 'exclude'),
      'invited', count(*) filter (where am.invited),
      'unsubscribed', count(*) filter (where am.mode is distinct from 'exclude' and am.unsubscribed and not am.invited),
      'to_invite', count(*) filter (where am.mode is distinct from 'exclude' and not am.unsubscribed and not am.invited)
    ),
    'max_invitees', private.app_limit('invitees_per_meeting_max')
  )
  into v_result
  from private.audience_members(p_meeting) am
  right join (select 1) one on true
  left join public.contacts c on c.id = am.contact_id;
  return v_result;
end;
$$;

create function public.list_meetings(p_workspace uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not private.is_member(p_workspace) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  return coalesce((
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', m.id,
        'title', m.title,
        'starts_at', m.starts_at,
        'timezone', m.timezone,
        'duration_minutes', m.duration_minutes,
        'status', m.status,
        'location_mode', m.location_mode,
        'invited_count', (select count(*) from public.meeting_invitees i where i.meeting_id = m.id),
        'sent_count', (select count(*) from public.meeting_invitees i where i.meeting_id = m.id and i.email_status = 'sent')
      )
      order by m.starts_at nulls last, m.created_at desc
    )
    from public.meetings m
    where m.workspace_id = p_workspace
  ), '[]'::jsonb);
end;
$$;

-- A one-off guest imported later joins the roster as a new contact (spec §6 is_adhoc).
create or replace function public.import_contacts(
  p_workspace uuid,
  p_rows jsonb,
  p_dry_run boolean,
  p_also_add_to_list uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_groups jsonb;
  v_rows jsonb;
  v_new_lists text[];
  v_also_name text;
  v_contacts_after integer;
  v_lists_after integer;
  v_limit_exceeded text;
begin
  if not private.is_member(p_workspace, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if p_rows is null or pg_catalog.jsonb_typeof(p_rows) <> 'array' then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if pg_catalog.jsonb_array_length(p_rows) > private.app_limit('import_rows_max') then
    raise exception 'tn:import_too_many_rows' using errcode = 'P0001';
  end if;
  if p_also_add_to_list is not null then
    select l.name into v_also_name from public.lists l
    where l.id = p_also_add_to_list and l.workspace_id = p_workspace;
    if v_also_name is null then
      raise exception 'tn:not_found' using errcode = 'P0001';
    end if;
  end if;
  -- "+ Add" is a one-row commit with its own, larger budget (owner decision 2026-10-07).
  if not private.hit_user_rate_limit(case
    when p_dry_run then 'import_preview'
    when pg_catalog.jsonb_array_length(p_rows) = 1 then 'contact_add'
    else 'import'
  end) then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;

  with input as (
    -- One row per element: normalized email, whitespace-collapsed name, raw list cells.
    select
      r.ord::integer as idx,
      coalesce(
        case when pg_catalog.jsonb_typeof(r.value -> 'row') = 'number' then (r.value ->> 'row')::numeric::integer end,
        r.ord::integer
      ) as row_no,
      lower(btrim(coalesce(r.value ->> 'email', ''))) as email,
      nullif(btrim(regexp_replace(coalesce(r.value ->> 'full_name', ''), '[[:space:]]+', ' ', 'g')), '') as full_name,
      case when pg_catalog.jsonb_typeof(r.value -> 'lists') = 'array' then r.value -> 'lists' else '[]'::jsonb end as lists_json
    from pg_catalog.jsonb_array_elements(p_rows) with ordinality as r(value, ord)
  ),
  input_lists as (
    select i.idx, l.ord::integer as ord, btrim(regexp_replace(l.value, '[[:space:]]+', ' ', 'g')) as name
    from input i
    cross join lateral pg_catalog.jsonb_array_elements_text(i.lists_json) with ordinality as l(value, ord)
  ),
  checked as (
    select i.idx, i.row_no, i.email, i.full_name,
      case
        when i.email = '' then 'email_missing'
        when not private.is_valid_email(i.email) then 'email_invalid'
        when char_length(i.full_name) > 120 then 'name_too_long'
        when exists (select 1 from input_lists il where il.idx = i.idx and char_length(il.name) > 60) then 'list_name_too_long'
      end as reason
    from input i
  ),
  grouped as (
    -- Rows sharing an email merge: the last non-empty name wins.
    select ch.email,
      (array_agg(ch.full_name order by ch.idx desc) filter (where ch.full_name is not null))[1] as file_name,
      array_agg(ch.row_no order by ch.idx) as row_nos,
      min(ch.idx) as first_idx
    from checked ch
    where ch.reason is null
    group by ch.email
  ),
  people as (
    select g.email, g.file_name, g.row_nos, g.first_idx,
      c.id as existing_id, c.full_name as existing_name,
      c.is_adhoc as existing_adhoc,
      coalesce(g.file_name, c.full_name) as full_name
    from grouped g
    left join public.contacts c on c.workspace_id = p_workspace and c.email = g.email
  ),
  group_lists as (
    -- Each email's list names, case-insensitively de-duplicated (first spelling wins), resolved
    -- to an existing list when one matches ignoring case.
    select distinct on (ch.email, lower(il.name))
      ch.email, il.name, ch.idx, il.ord, l.id as list_id
    from checked ch
    join people g on g.email = ch.email and g.full_name is not null
    join input_lists il on il.idx = ch.idx and il.name <> ''
    left join public.lists l on l.workspace_id = p_workspace and lower(l.name) = lower(il.name)
    where ch.reason is null
    order by ch.email, lower(il.name), ch.idx, il.ord
  ),
  new_lists as (
    select distinct on (lower(gl.name)) gl.name, gl.idx, gl.ord
    from group_lists gl
    where gl.list_id is null
    order by lower(gl.name), gl.idx, gl.ord
  ),
  added as (
    -- Lists each person would gain: every list for a new contact, missing memberships otherwise.
    select gl.email, gl.name
    from group_lists gl
    join people g on g.email = gl.email
    where g.existing_id is null or g.existing_adhoc
      or gl.list_id is null
      or not exists (select 1 from public.list_contacts lc where lc.list_id = gl.list_id and lc.contact_id = g.existing_id)
    union all
    select g.email, v_also_name
    from people g
    where v_also_name is not null
      and g.full_name is not null
      and not exists (select 1 from group_lists gl where gl.email = g.email and lower(gl.name) = lower(v_also_name))
      and (
        g.existing_id is null
        or not exists (select 1 from public.list_contacts lc where lc.list_id = p_also_add_to_list and lc.contact_id = g.existing_id)
      )
  ),
  final_groups as (
    select g.email, g.full_name, g.existing_name, g.file_name, g.row_nos, g.first_idx,
      coalesce((select array_agg(a.name order by lower(a.name)) from added a where a.email = g.email), '{}') as added_lists,
      coalesce((select array_agg(gl.name order by gl.idx, gl.ord) from group_lists gl where gl.email = g.email), '{}') as lists,
      case
        when g.existing_id is null or g.existing_adhoc then 'new'
        when (g.file_name is not null and g.file_name <> g.existing_name)
          or exists (select 1 from added a where a.email = g.email) then 'updated'
        else 'unchanged'
      end as outcome
    from people g
    where g.full_name is not null
  ),
  row_results as (
    select ch.idx, pg_catalog.jsonb_build_object(
      'row', ch.row_no, 'email', ch.email, 'full_name', ch.full_name, 'outcome', 'invalid',
      'reason', ch.reason, 'added_lists', '[]'::jsonb, 'previous_name', null, 'merged_rows', '[]'::jsonb
    ) as result
    from checked ch
    where ch.reason is not null
    union all
    select ch.idx, pg_catalog.jsonb_build_object(
      'row', ch.row_no, 'email', ch.email, 'full_name', null, 'outcome', 'invalid',
      'reason', 'name_missing', 'added_lists', '[]'::jsonb, 'previous_name', null, 'merged_rows', '[]'::jsonb
    )
    from checked ch
    join people g on g.email = ch.email and g.full_name is null
    where ch.reason is null
    union all
    select fg.first_idx, pg_catalog.jsonb_build_object(
      'row', fg.row_nos[1], 'email', fg.email, 'full_name', fg.full_name, 'outcome', fg.outcome,
      'reason', null,
      'added_lists', pg_catalog.to_jsonb(fg.added_lists),
      'previous_name', case when fg.outcome = 'updated' and fg.file_name is not null and fg.file_name <> fg.existing_name then fg.existing_name end,
      'merged_rows', pg_catalog.to_jsonb(fg.row_nos[2:])
    )
    from final_groups fg
  )
  select
    coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'email', fg.email, 'full_name', fg.full_name, 'lists', pg_catalog.to_jsonb(fg.lists), 'outcome', fg.outcome
      ))
      from final_groups fg
    ), '[]'::jsonb),
    coalesce((select pg_catalog.jsonb_agg(rr.result order by rr.idx) from row_results rr), '[]'::jsonb),
    coalesce((select array_agg(nl.name order by nl.idx, nl.ord) from new_lists nl), '{}')
  into v_groups, v_rows, v_new_lists;

  -- Caps as they would stand after this import (the insert triggers stay the final word).
  select count(*) + (
    select count(*) from pg_catalog.jsonb_array_elements(v_groups) g where g ->> 'outcome' = 'new'
  ) into v_contacts_after
  from public.contacts c where c.workspace_id = p_workspace and not c.is_adhoc;
  select count(*) + coalesce(array_length(v_new_lists, 1), 0) into v_lists_after
  from public.lists l where l.workspace_id = p_workspace;
  v_limit_exceeded := case
    when v_contacts_after > private.app_limit('contacts_per_workspace_max') then 'contacts'
    when v_lists_after > private.app_limit('lists_per_workspace_max') then 'lists'
  end;

  if not p_dry_run then
    if v_limit_exceeded = 'contacts' then
      raise exception 'tn:contacts_limit_reached' using errcode = 'P0001';
    elsif v_limit_exceeded = 'lists' then
      raise exception 'tn:lists_limit_reached' using errcode = 'P0001';
    end if;

    insert into public.lists (workspace_id, name)
    select p_workspace, n.name from pg_catalog.unnest(v_new_lists) as n(name)
    on conflict (workspace_id, lower(name)) do nothing;

    insert into public.contacts (workspace_id, email, full_name)
    select p_workspace, g.email, g.full_name
    from pg_catalog.jsonb_to_recordset(v_groups) as g(email text, full_name text, lists text[], outcome text)
    where g.outcome <> 'unchanged'
    on conflict (workspace_id, email) do update
      set full_name = excluded.full_name, is_adhoc = false
      where public.contacts.full_name is distinct from excluded.full_name or public.contacts.is_adhoc;

    insert into public.list_contacts (workspace_id, list_id, contact_id)
    select p_workspace, l.id, c.id
    from pg_catalog.jsonb_to_recordset(v_groups) as g(email text, full_name text, lists text[], outcome text)
    join public.contacts c on c.workspace_id = p_workspace and c.email = g.email
    cross join lateral pg_catalog.unnest(g.lists) as n(name)
    join public.lists l on l.workspace_id = p_workspace and lower(l.name) = lower(n.name)
    on conflict do nothing;

    if p_also_add_to_list is not null then
      insert into public.list_contacts (workspace_id, list_id, contact_id)
      select p_workspace, p_also_add_to_list, c.id
      from pg_catalog.jsonb_to_recordset(v_groups) as g(email text)
      join public.contacts c on c.workspace_id = p_workspace and c.email = g.email
      on conflict do nothing;
    end if;
  end if;

  return pg_catalog.jsonb_build_object(
    'summary', pg_catalog.jsonb_build_object(
      'new', (select count(*) from pg_catalog.jsonb_array_elements(v_groups) g where g ->> 'outcome' = 'new'),
      'updated', (select count(*) from pg_catalog.jsonb_array_elements(v_groups) g where g ->> 'outcome' = 'updated'),
      'unchanged', (select count(*) from pg_catalog.jsonb_array_elements(v_groups) g where g ->> 'outcome' = 'unchanged'),
      'invalid', (select count(*) from pg_catalog.jsonb_array_elements(v_rows) r where r ->> 'outcome' = 'invalid'),
      'merged', (select coalesce(sum(pg_catalog.jsonb_array_length(r -> 'merged_rows')), 0) from pg_catalog.jsonb_array_elements(v_rows) r)
    ),
    'new_lists', pg_catalog.to_jsonb(v_new_lists),
    'limit_exceeded', v_limit_exceeded,
    'rows', v_rows
  );
end;
$$;

revoke execute on all functions in schema private from public, anon;
grant execute on function
  private.audience_members(uuid),
  private.add_meeting_people(uuid, jsonb, boolean),
  private.create_meeting(uuid),
  private.set_meeting_audience(uuid, uuid[], uuid[], uuid[])
to authenticated;
grant execute on function private.audience_members(uuid) to service_role;

revoke execute on function
  public.create_meeting(uuid),
  public.set_meeting_audience(uuid, uuid[], uuid[], uuid[]),
  public.add_meeting_people(uuid, jsonb, boolean),
  public.meeting_audience(uuid),
  public.list_meetings(uuid)
from public, anon;
grant execute on function
  public.create_meeting(uuid),
  public.set_meeting_audience(uuid, uuid[], uuid[], uuid[]),
  public.add_meeting_people(uuid, jsonb, boolean),
  public.meeting_audience(uuid),
  public.list_meetings(uuid)
to authenticated;
