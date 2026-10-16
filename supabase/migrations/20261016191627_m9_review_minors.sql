-- M9 final review minors (2026-10-16): a workspaces-list cursor that doesn't fit its sort answers
-- invalid input instead of failing in the casts.
-- Copied from 20261016111710_m9_admin_reads.sql (the newest that defines it).
create or replace function private.admin_workspaces(
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
  -- A cursor that doesn't fit the sort (tampered or from another sort) is invalid input, not a
  -- server error from the casts below.
  if p_after_id is not null then
    begin
      perform case p_sort when 'newest' then p_after_value::timestamptz::text else p_after_value::integer::text end;
    exception when data_exception then
      raise exception 'tn:invalid_input' using errcode = 'P0001';
    end;
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
