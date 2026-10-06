-- M3 import (spec §6 `import_contacts`, §7.14): one function computes the preview (dry run) and
-- applies the same plan (commit), so the two cannot drift.

create function public.import_contacts(
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
  if not private.hit_user_rate_limit(case when p_dry_run then 'import_preview' else 'import' end) then
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
    where g.existing_id is null
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
        when g.existing_id is null then 'new'
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
      set full_name = excluded.full_name
      where public.contacts.full_name is distinct from excluded.full_name;

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

revoke execute on function public.import_contacts(uuid, jsonb, boolean, uuid) from public, anon;
grant execute on function public.import_contacts(uuid, jsonb, boolean, uuid) to authenticated;
