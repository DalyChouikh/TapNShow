-- M2 invites (spec §6, §7.13): email-bound, single-use, hashed tokens, 7-day expiry.

create table public.workspace_invites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  email text not null check (
    email = lower(btrim(email))
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    and char_length(email) <= 254
  ),
  role public.workspace_role not null check (role in ('admin', 'viewer')),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index workspace_invites_one_open on public.workspace_invites (workspace_id, email)
  where accepted_at is null and revoked_at is null;
create index workspace_invites_workspace_idx on public.workspace_invites (workspace_id);
create trigger workspace_invites_set_updated_at
  before update on public.workspace_invites
  for each row execute function private.set_updated_at();

alter table public.workspace_invites enable row level security;
revoke all on table public.workspace_invites from anon, authenticated;
grant select (id, workspace_id, email, role, invited_by, expires_at, accepted_at, revoked_at, created_at)
  on table public.workspace_invites to authenticated;
grant all on table public.workspace_invites to service_role;
create policy workspace_invites_select_managers on public.workspace_invites
  for select to authenticated
  using (private.is_member(workspace_id, array['owner', 'admin']::public.workspace_role[]));

create function private.can_manage_invite_role(p_workspace uuid, p_role public.workspace_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case private.role_of(p_workspace)
    when 'owner' then true
    when 'admin' then p_role = 'viewer'
    else false
  end;
$$;

create function private.mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select left(split_part(p_email, '@', 1), 1) || '•••@' || split_part(p_email, '@', 2);
$$;

-- Order matters: a member revisiting their own accepted link sees "already_member", not "used".
create function private.invite_status(p_invite public.workspace_invites)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_confirmed_at timestamptz;
begin
  if p_invite.revoked_at is not null then
    return 'revoked';
  end if;
  if exists (
    select 1 from public.workspace_roles r
    where r.workspace_id = p_invite.workspace_id and r.user_id = auth.uid()
  ) then
    return 'already_member';
  end if;
  if p_invite.accepted_at is not null then
    return 'used';
  end if;
  if p_invite.expires_at <= pg_catalog.now() then
    return 'expired';
  end if;
  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed_at from auth.users u where u.id = auth.uid();
  if v_confirmed_at is null or v_email is distinct from p_invite.email then
    return 'wrong_account';
  end if;
  return 'ready';
end;
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_member(uuid, public.workspace_role[]) to authenticated;
grant execute on function private.role_of(uuid) to authenticated;

create function public.create_invite(p_workspace uuid, p_email text, p_role public.workspace_role, p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_open_role public.workspace_role;
  v_id uuid;
begin
  if p_role not in ('admin', 'viewer') then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if not private.can_manage_invite_role(p_workspace, p_role) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(v_email) > 254 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from public.workspace_roles r join auth.users u on u.id = r.user_id
    where r.workspace_id = p_workspace and lower(u.email) = v_email
  ) then
    raise exception 'tn:already_member' using errcode = 'P0001';
  end if;
  select i.role into v_open_role from public.workspace_invites i
  where i.workspace_id = p_workspace and i.email = v_email and i.accepted_at is null and i.revoked_at is null
  for update;
  if v_open_role is not null and not private.can_manage_invite_role(p_workspace, v_open_role) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  update public.workspace_invites set revoked_at = pg_catalog.now()
  where workspace_id = p_workspace and email = v_email and accepted_at is null and revoked_at is null;
  insert into public.workspace_invites (workspace_id, email, role, token_hash, invited_by, expires_at)
  values (
    p_workspace, v_email, p_role, p_token_hash, auth.uid(),
    pg_catalog.now() + pg_catalog.make_interval(days => private.app_limit('invite_expiry_days'))
  )
  returning id into v_id;
  return v_id;
end;
$$;

create function public.renew_invite(p_invite uuid, p_token_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.workspace_invites;
begin
  select * into v_invite from public.workspace_invites i where i.id = p_invite for update;
  if v_invite.id is null or not private.is_member(v_invite.workspace_id, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if not private.can_manage_invite_role(v_invite.workspace_id, v_invite.role) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if v_invite.accepted_at is not null or v_invite.revoked_at is not null then
    raise exception 'tn:invite_closed' using errcode = 'P0001';
  end if;
  update public.workspace_invites
  set token_hash = p_token_hash,
      invited_by = auth.uid(),
      expires_at = pg_catalog.now() + pg_catalog.make_interval(days => private.app_limit('invite_expiry_days'))
  where id = p_invite;
end;
$$;

create function public.revoke_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.workspace_invites;
begin
  select * into v_invite from public.workspace_invites i where i.id = p_invite for update;
  if v_invite.id is null or not private.is_member(v_invite.workspace_id, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if not private.can_manage_invite_role(v_invite.workspace_id, v_invite.role) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  update public.workspace_invites set revoked_at = pg_catalog.now()
  where id = p_invite and accepted_at is null and revoked_at is null;
end;
$$;

create function public.consume_invite_email(p_workspace uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_member(p_workspace, array['owner', 'admin']::public.workspace_role[]) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if not private.hit_rate_limit('invite_email:workspace:' || p_workspace, private.app_limit('invite_email_workspace_per_day'), interval '24 hours') then
    return false;
  end if;
  return private.hit_rate_limit('invite_email:platform', private.app_limit('invite_email_platform_per_day'), interval '24 hours');
end;
$$;

create function public.invite_preview(p_token_hash text)
returns table (status text, workspace_name text, workspace_slug text, role public.workspace_role, masked_email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_invite public.workspace_invites;
begin
  if auth.uid() is null then
    raise exception 'tn:unauthenticated' using errcode = 'P0001';
  end if;
  select * into v_invite from public.workspace_invites i where i.token_hash = p_token_hash;
  if v_invite.id is null then
    return query select 'not_found'::text, null::text, null::text, null::public.workspace_role, null::text;
    return;
  end if;
  return query
    select private.invite_status(v_invite), w.name, w.slug, v_invite.role, private.mask_email(v_invite.email)
    from public.workspaces w where w.id = v_invite.workspace_id;
end;
$$;

create function public.accept_invite(p_token_hash text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.workspace_invites;
  v_status text;
  v_slug text;
begin
  if auth.uid() is null then
    raise exception 'tn:unauthenticated' using errcode = 'P0001';
  end if;
  select * into v_invite from public.workspace_invites i where i.token_hash = p_token_hash for update;
  if v_invite.id is null then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  v_status := private.invite_status(v_invite);
  if v_status <> 'ready' then
    raise exception '%', 'tn:invite_' || v_status using errcode = 'P0001';
  end if;
  insert into public.workspace_roles (workspace_id, user_id, role) values (v_invite.workspace_id, auth.uid(), v_invite.role);
  update public.workspace_invites set accepted_at = pg_catalog.now(), accepted_by = auth.uid() where id = v_invite.id;
  update public.profiles set last_workspace_id = v_invite.workspace_id where user_id = auth.uid();
  select w.slug into v_slug from public.workspaces w where w.id = v_invite.workspace_id;
  return v_slug;
end;
$$;

revoke execute on function
  public.create_invite(uuid, text, public.workspace_role, text),
  public.renew_invite(uuid, text),
  public.revoke_invite(uuid),
  public.consume_invite_email(uuid),
  public.invite_preview(text),
  public.accept_invite(text)
from public, anon;
grant execute on function
  public.create_invite(uuid, text, public.workspace_role, text),
  public.renew_invite(uuid, text),
  public.revoke_invite(uuid),
  public.consume_invite_email(uuid),
  public.invite_preview(text),
  public.accept_invite(text)
to authenticated;
