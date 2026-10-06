-- M2 membership changes (spec §3, §7.11). Owner-only: Admin management, transfer, delete.

create function public.change_role(
  p_workspace uuid,
  p_user uuid,
  p_role public.workspace_role,
  p_can_check_in boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.workspace_role := private.role_of(p_workspace);
  v_target public.workspace_role;
begin
  if v_caller is null or v_caller = 'viewer' then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  select r.role into v_target from public.workspace_roles r
  where r.workspace_id = p_workspace and r.user_id = p_user
  for update;
  if v_target is null then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if p_role = 'owner' or v_target = 'owner' then
    raise exception 'tn:use_transfer' using errcode = 'P0001';
  end if;
  if (v_target = 'admin' or p_role = 'admin') and v_caller <> 'owner' then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  update public.workspace_roles
  set role = p_role,
      can_check_in = (p_role = 'viewer' and coalesce(p_can_check_in, false))
  where workspace_id = p_workspace and user_id = p_user;
end;
$$;

create function public.remove_member(p_workspace uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.workspace_role := private.role_of(p_workspace);
  v_target public.workspace_role;
begin
  if v_caller is null or v_caller = 'viewer' then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if p_user = auth.uid() then
    raise exception 'tn:use_leave' using errcode = 'P0001';
  end if;
  select r.role into v_target from public.workspace_roles r
  where r.workspace_id = p_workspace and r.user_id = p_user
  for update;
  if v_target is null then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if v_target = 'owner' or (v_target = 'admin' and v_caller <> 'owner') then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  delete from public.workspace_roles where workspace_id = p_workspace and user_id = p_user;
  update public.profiles set last_workspace_id = null where user_id = p_user and last_workspace_id = p_workspace;
end;
$$;

create function public.leave_workspace(p_workspace uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller public.workspace_role := private.role_of(p_workspace);
begin
  if v_caller is null then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if v_caller = 'owner' then
    raise exception 'tn:owner_cannot_leave' using errcode = 'P0001';
  end if;
  delete from public.workspace_roles where workspace_id = p_workspace and user_id = auth.uid();
  update public.profiles set last_workspace_id = null where user_id = auth.uid() and last_workspace_id = p_workspace;
end;
$$;

create function public.transfer_ownership(p_workspace uuid, p_new_owner uuid, p_confirm_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_target public.workspace_role;
begin
  if private.role_of(p_workspace) is distinct from 'owner' then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  select w.name into v_name from public.workspaces w where w.id = p_workspace for update;
  if btrim(coalesce(p_confirm_name, '')) <> v_name then
    raise exception 'tn:name_mismatch' using errcode = 'P0001';
  end if;
  select r.role into v_target from public.workspace_roles r
  where r.workspace_id = p_workspace and r.user_id = p_new_owner
  for update;
  if v_target is distinct from 'admin' then
    raise exception 'tn:target_not_admin' using errcode = 'P0001';
  end if;
  update public.workspace_roles set role = 'admin'
  where workspace_id = p_workspace and user_id = auth.uid();
  update public.workspace_roles set role = 'owner', can_check_in = false
  where workspace_id = p_workspace and user_id = p_new_owner;
end;
$$;

create function public.delete_workspace(p_workspace uuid, p_confirm_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if private.role_of(p_workspace) is distinct from 'owner' then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  select w.name into v_name from public.workspaces w where w.id = p_workspace for update;
  if btrim(coalesce(p_confirm_name, '')) <> v_name then
    raise exception 'tn:name_mismatch' using errcode = 'P0001';
  end if;
  delete from public.workspaces where id = p_workspace;
end;
$$;

revoke execute on function
  public.change_role(uuid, uuid, public.workspace_role, boolean),
  public.remove_member(uuid, uuid),
  public.leave_workspace(uuid),
  public.transfer_ownership(uuid, uuid, text),
  public.delete_workspace(uuid, text)
from public, anon;
grant execute on function
  public.change_role(uuid, uuid, public.workspace_role, boolean),
  public.remove_member(uuid, uuid),
  public.leave_workspace(uuid),
  public.transfer_ownership(uuid, uuid, text),
  public.delete_workspace(uuid, text)
to authenticated;
