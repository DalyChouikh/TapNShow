-- The team's counts go to the Owner only (#413, final review minor): Admins and Viewers get their
-- own line, never the team's numbers, and the counts aren't computed for them.

-- Latest body: sheet_sharing from 20261021065952_sheet_share_views.sql.
create or replace function private.sheet_sharing(p_workspace uuid, p_role public.workspace_role)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select pg_catalog.lower(u.email::text) as email from auth.users u
    where u.id = auth.uid() and p_role <> 'owner'
  )
  select pg_catalog.jsonb_build_object(
    'team', case when p_role = 'owner' then (
      select pg_catalog.jsonb_build_object(
        'team_count', (
          select count(*)::integer from public.workspace_roles r
          where r.workspace_id = p_workspace and r.role <> 'owner'),
        'total', c.total,
        'can_view', c.can_view,
        'cant_open', c.cant_open,
        'in_progress', c.total - c.can_view - c.cant_open)
      from (
        select count(*)::integer as total,
          (count(*) filter (where sh.state in ('shared', 'external')))::integer as can_view,
          (count(*) filter (where sh.state = 'refused'))::integer as cant_open
        from private.sheet_share_targets(p_workspace) t
        left join public.sheet_shares sh on sh.workspace_id = p_workspace and sh.email = t.email
      ) c) end,
    'mine', case
      when me.email is null or s.workspace_id is null then null
      when me.email = pg_catalog.lower(s.google_email) then 'sheet_account'
      when sh.state in ('shared', 'external') then 'shared'
      when sh.state = 'refused' then 'refused'
      else 'sharing' end,
    'my_email', me.email)
  from (select 1) as one
  left join me on true
  left join public.sheet_syncs s on s.workspace_id = p_workspace
  left join public.sheet_shares sh on sh.workspace_id = p_workspace and sh.email = me.email
$$;
