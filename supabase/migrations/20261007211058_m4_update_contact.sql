-- #119: one atomic edit for the roster sheet, scoped to the slug's workspace.
create function public.update_contact(
  p_workspace uuid,
  p_contact uuid,
  p_full_name text,
  p_email text,
  p_list_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.is_member(p_workspace, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.contacts c where c.id = p_contact and c.workspace_id = p_workspace and not c.is_adhoc) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if p_list_ids is not null and exists (
    select 1 from pg_catalog.unnest(p_list_ids) as x(id)
    where not exists (select 1 from public.lists l where l.id = x.id and l.workspace_id = p_workspace)
  ) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if p_full_name is not null or p_email is not null then
    update public.contacts
    set full_name = coalesce(p_full_name, full_name), email = coalesce(p_email, email)
    where id = p_contact;
  end if;
  if p_list_ids is not null then
    delete from public.list_contacts lc where lc.contact_id = p_contact and lc.list_id <> all (p_list_ids);
    insert into public.list_contacts (workspace_id, list_id, contact_id)
    select p_workspace, x.id, p_contact from pg_catalog.unnest(p_list_ids) as x(id)
    on conflict do nothing;
  end if;
end;
$$;
revoke execute on function public.update_contact(uuid, uuid, text, text, uuid[]) from public, anon;
grant execute on function public.update_contact(uuid, uuid, text, text, uuid[]) to authenticated;
