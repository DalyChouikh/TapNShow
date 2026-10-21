-- What Settings shows about sharing the Google Sheet with the team (#413, design §3).

-- The team's sharing as one person sees it: the counts over the people TapNShow shares with
-- (private.sheet_share_targets; can view = shared or already had access, can't open = refused for
-- any reason, the rest in progress), Admins + Viewers for the connect dialog, and for a team
-- member (not the Owner) their own line. One pass over the targets and their rows.
create function private.sheet_sharing(p_workspace uuid, p_role public.workspace_role)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with counts as (
    select count(*)::integer as total,
      (count(*) filter (where sh.state in ('shared', 'external')))::integer as can_view,
      (count(*) filter (where sh.state = 'refused'))::integer as cant_open
    from private.sheet_share_targets(p_workspace) t
    left join public.sheet_shares sh on sh.workspace_id = p_workspace and sh.email = t.email
  ), me as (
    select pg_catalog.lower(u.email::text) as email from auth.users u
    where u.id = auth.uid() and p_role <> 'owner'
  )
  select pg_catalog.jsonb_build_object(
    'team_count', (
      select count(*)::integer from public.workspace_roles r
      where r.workspace_id = p_workspace and r.role <> 'owner'),
    'total', c.total,
    'can_view', c.can_view,
    'cant_open', c.cant_open,
    'in_progress', c.total - c.can_view - c.cant_open,
    'mine', case
      when me.email is null or s.workspace_id is null then null
      when me.email = pg_catalog.lower(s.google_email) then 'sheet_account'
      when sh.state in ('shared', 'external') then 'shared'
      when sh.state = 'refused' then 'refused'
      else 'sharing' end,
    'my_email', me.email)
  from counts c
  left join me on true
  left join public.sheet_syncs s on s.workspace_id = p_workspace
  left join public.sheet_shares sh on sh.workspace_id = p_workspace and sh.email = me.email
$$;
revoke execute on function private.sheet_sharing(uuid, public.workspace_role) from public, anon, authenticated;

-- Latest body: workspace_sheet from 20261011091257_m7_sheet_state.sql; adds `sharing` (null while
-- the switch is off, so the screens show nothing of it).
create or replace function private.workspace_sheet(p_workspace uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.workspace_role := private.role_of(p_workspace);
begin
  if v_role is null then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  return (
    select pg_catalog.jsonb_build_object(
      'state', case when s.workspace_id is null then 'off' when s.status = 'paused' then 'paused'
                    when s.spreadsheet_id is null then 'creating' else 'on' end,
      'spreadsheet_id', s.spreadsheet_id,
      'paused_reason', s.paused_reason,
      'synced_at', s.synced_at,
      'behind', exists (select 1 from public.sheet_dirty_years d where d.workspace_id = p_workspace),
      'created_at', s.created_at,
      'turned_on_by', coalesce(p.display_name, ''),
      'account_email', case when v_role = 'owner' then s.google_email end,
      'owner_name', coalesce((
        select op.display_name from public.workspace_roles r
        left join public.profiles op on op.user_id = r.user_id
        where r.workspace_id = p_workspace and r.role = 'owner'), ''),
      'tabs', coalesce((
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'year', t.year, 'google_sheet_id', t.google_sheet_id,
          'starts_from', t.starts_from, 'starts_to', t.starts_to)
          order by t.year desc, t.starts_to desc nulls last)
        from public.sheet_tabs t where t.workspace_id = p_workspace), '[]'::jsonb),
      'sharing', case when private.app_flag('sheet_team_sharing')
        then private.sheet_sharing(p_workspace, v_role) end
    )
    from (select 1) as one
    left join public.sheet_syncs s on s.workspace_id = p_workspace
    left join public.profiles p on p.user_id = s.created_by
  );
end;
$$;

-- Latest body: members_page from 20261008214448_m5_members_invites_pages.sql; adds `sheet_access`
-- for the Owner only (the "Can't open the sheet" tag, design §3): null while the switch is off,
-- without a sheet, for anyone else, and for the member whose Google account holds the file. One
-- left join on the page's rows (the unique (workspace_id, email) index), still keyset-paginated.
create or replace function private.members_page(
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
  v_sheet_account text;
begin
  if not private.is_member(p_workspace) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if p_limit not between 1 and 100 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if private.role_of(p_workspace) = 'owner' and private.app_flag('sheet_team_sharing') then
    select pg_catalog.lower(s.google_email) into v_sheet_account
    from public.sheet_syncs s where s.workspace_id = p_workspace;
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
  select coalesce(pg_catalog.jsonb_agg(
      pg_catalog.to_jsonb(page) || pg_catalog.jsonb_build_object('sheet_access', case
        when v_sheet_account is null or pg_catalog.lower(page.email) = v_sheet_account then null
        when sh.state in ('shared', 'external') then 'can_view'
        when sh.state = 'refused' then 'cant_open'
        else 'pending' end)
      order by page.role, page.sort_name, page.user_id), '[]'::jsonb),
    count(*)
  into v_rows, v_count
  from page
  left join public.sheet_shares sh
    on v_sheet_account is not null and sh.workspace_id = p_workspace and sh.email = pg_catalog.lower(page.email);
  return pg_catalog.jsonb_build_object(
    'has_more', v_count > p_limit,
    'items', coalesce((select pg_catalog.jsonb_agg(e) from pg_catalog.jsonb_array_elements(v_rows) with ordinality as t(e, n) where t.n <= p_limit), '[]'::jsonb)
  );
end;
$$;
