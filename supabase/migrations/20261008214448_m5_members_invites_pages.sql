-- #174: Settings > People and pending invites load in pages; the Meetings list moved to
-- meetings_page (Task 5), so list_meetings goes.

drop function public.list_meetings(uuid);

create function private.members_page(
  p_workspace uuid,
  p_role public.workspace_role,
  p_after_role public.workspace_role,
  p_after_name text,
  p_after_id uuid,
  p_limit integer
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
    select r.user_id, r.role, r.can_check_in, p.display_name, p.avatar_url, u.email::text as email,
      r.created_at as joined_at, lower(coalesce(p.display_name, u.email::text)) as sort_name
    from public.workspace_roles r
    join auth.users u on u.id = r.user_id
    left join public.profiles p on p.user_id = r.user_id
    where r.workspace_id = p_workspace
      and (p_role is null or r.role = p_role)
      and (p_after_id is null
        or (r.role, lower(coalesce(p.display_name, u.email::text)), r.user_id) > (p_after_role, p_after_name, p_after_id))
    order by r.role, lower(coalesce(p.display_name, u.email::text)), r.user_id
    limit p_limit + 1
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(page) order by page.role, page.sort_name, page.user_id), '[]'::jsonb),
    count(*)
  into v_rows, v_count
  from page;
  return pg_catalog.jsonb_build_object(
    'has_more', v_count > p_limit,
    'items', coalesce((select pg_catalog.jsonb_agg(e) from pg_catalog.jsonb_array_elements(v_rows) with ordinality as t(e, n) where t.n <= p_limit), '[]'::jsonb)
  );
end;
$$;
revoke execute on function private.members_page(uuid, public.workspace_role, public.workspace_role, text, uuid, integer) from public, anon;
grant execute on function private.members_page(uuid, public.workspace_role, public.workspace_role, text, uuid, integer) to authenticated;

create function public.members_page(
  p_workspace uuid,
  p_role public.workspace_role default null,
  p_after_role public.workspace_role default null,
  p_after_name text default null,
  p_after_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.members_page(p_workspace, p_role, p_after_role, p_after_name, p_after_id, p_limit) $$;
revoke execute on function public.members_page(uuid, public.workspace_role, public.workspace_role, text, uuid, integer) from public, anon;
grant execute on function public.members_page(uuid, public.workspace_role, public.workspace_role, text, uuid, integer) to authenticated;

create index workspace_invites_open_idx on public.workspace_invites (workspace_id, created_at desc, id desc)
  where accepted_at is null and revoked_at is null;

create function public.invites_page(
  p_workspace uuid,
  p_after_created timestamptz default null,
  p_after_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_count integer;
begin
  if p_limit not between 1 and 100 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  with page as (
    select i.id, i.email, i.role, i.expires_at, i.created_at
    from public.workspace_invites i
    where i.workspace_id = p_workspace and i.accepted_at is null and i.revoked_at is null
      and (p_after_id is null or (i.created_at, i.id) < (p_after_created, p_after_id))
    order by i.created_at desc, i.id desc
    limit p_limit + 1
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(page) order by page.created_at desc, page.id desc), '[]'::jsonb), count(*)
  into v_rows, v_count
  from page;
  return pg_catalog.jsonb_build_object(
    'has_more', v_count > p_limit,
    'items', coalesce((select pg_catalog.jsonb_agg(e) from pg_catalog.jsonb_array_elements(v_rows) with ordinality as t(e, n) where t.n <= p_limit), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.invites_page(uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.invites_page(uuid, timestamptz, uuid, integer) to authenticated;

-- #174 measurement: meeting_audience took ~3 s at 2,000 contacts (a correlated list subquery per
-- contact, each under RLS). Set-based rewrite: each table read once, aggregates joined.
create or replace function private.audience_members(p_meeting uuid)
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
  with picked as materialized (
    select a.list_id from public.meeting_audience a where a.meeting_id = p_meeting
  ), facts as (
    select lc.contact_id, lc.list_id, null::public.audience_mode as mode, false as invited
    from public.list_contacts lc
    join picked on picked.list_id = lc.list_id
    union all
    select p.contact_id, null, p.mode, false
    from public.meeting_audience_people p
    where p.meeting_id = p_meeting
    union all
    select i.contact_id, null, null, true
    from public.meeting_invitees i
    where i.meeting_id = p_meeting
  ), per_contact as materialized (
    -- One row per contact: its picked lists, its include/exclude mark, whether it was invited.
    select f.contact_id,
      coalesce(pg_catalog.array_agg(f.list_id order by f.list_id) filter (where f.list_id is not null), '{}') as list_ids,
      max(f.mode) as mode,
      bool_or(f.invited) as invited
    from facts f
    group by f.contact_id
  )
  select c.id, pc.mode, pc.list_ids, c.unsubscribed_at is not null,
    c.unsubscribed_via is not distinct from 'report', pc.invited
  from per_contact pc
  join public.contacts c on c.id = pc.contact_id
  join public.meetings m on m.id = p_meeting and m.workspace_id = c.workspace_id;
$$;

-- The RLS probe per contact row cost ~280 ms at 2,000 contacts: the body moves to a definer that
-- checks membership once (spec §6 Access pattern (M5)); the public function becomes its wrapper.
create function private.meeting_audience(p_meeting uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
  v_result jsonb;
begin
  select m.workspace_id into v_workspace from public.meetings m where m.id = p_meeting;
  if v_workspace is null or not private.is_member(v_workspace) then
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
revoke execute on function private.meeting_audience(uuid) from public, anon;
grant execute on function private.meeting_audience(uuid) to authenticated;

create or replace function public.meeting_audience(p_meeting uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.meeting_audience(p_meeting) $$;
