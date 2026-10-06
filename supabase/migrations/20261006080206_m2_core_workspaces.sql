-- M2 core (spec §6, §11): private helpers, limits, rate limits, profiles, workspaces, roles.

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

create type public.workspace_role as enum ('owner', 'admin', 'viewer');

-- Single source of truth for numeric limits (spec §4, §8). TypeScript never repeats these.
create table private.app_limits (
  name text primary key,
  value integer not null check (value > 0)
);
alter table private.app_limits enable row level security;
insert into private.app_limits (name, value) values
  ('workspaces_owned_max', 10),
  ('workspace_create_per_hour', 5),
  ('otp_send_per_ip_per_hour', 20),
  ('invite_email_platform_per_day', 100),
  ('invite_email_workspace_per_day', 20),
  ('invite_expiry_days', 7);

create function private.app_limit(p_name text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_value integer;
begin
  select l.value into v_value from private.app_limits l where l.name = p_name;
  if v_value is null then
    raise exception 'unknown limit %', p_name;
  end if;
  return v_value;
end;
$$;

-- Rolling-window limiter (an event log, not fixed windows): a daily email budget must hold
-- for any 24 hours, because Gmail's 500/day limit is rolling. Denied attempts are not logged.
create table private.rate_limit_events (
  key text not null,
  occurred_at timestamptz not null default now()
);
create index rate_limit_events_key_time_idx on private.rate_limit_events (key, occurred_at);
alter table private.rate_limit_events enable row level security;

create function private.hit_rate_limit(p_key text, p_limit integer, p_window interval)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_key));
  delete from private.rate_limit_events e where e.key = p_key and e.occurred_at <= pg_catalog.now() - p_window;
  select count(*) into v_count from private.rate_limit_events e where e.key = p_key;
  if v_count >= p_limit then
    return false;
  end if;
  insert into private.rate_limit_events (key) values (p_key);
  return true;
end;
$$;

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 64),
  timezone text not null,
  locale text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function private.validate_workspace_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names t where t.name = new.timezone) then
    raise exception 'tn:invalid_timezone' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger workspaces_validate_timezone
  before insert or update of timezone on public.workspaces
  for each row execute function private.validate_workspace_timezone();
create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function private.set_updated_at();

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(btrim(display_name)) between 1 and 80),
  avatar_url text,
  locale text not null default 'en',
  last_workspace_id uuid references public.workspaces (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_last_workspace_idx on public.profiles (last_workspace_id);
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

create table public.workspace_roles (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.workspace_role not null,
  can_check_in boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id),
  constraint workspace_roles_check_in_viewers_only check (can_check_in = false or role = 'viewer')
);
create unique index workspace_roles_one_owner on public.workspace_roles (workspace_id) where role = 'owner';
create index workspace_roles_user_idx on public.workspace_roles (user_id);

-- Profile row for every auth user. Google's name/picture are copied for display only.
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name, avatar_url)
  values (
    new.id,
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), 80), ''),
    nullif(coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture', ''), '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

insert into public.profiles (user_id) select u.id from auth.users u on conflict (user_id) do nothing;

create function private.role_of(p_workspace uuid)
returns public.workspace_role
language sql
stable
security definer
set search_path = ''
as $$
  select r.role from public.workspace_roles r
  where r.workspace_id = p_workspace and r.user_id = (select auth.uid());
$$;

create function private.is_member(
  p_workspace uuid,
  p_roles public.workspace_role[] default array['owner', 'admin', 'viewer']::public.workspace_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.role_of(p_workspace) = any (p_roles), false);
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_member(uuid, public.workspace_role[]) to authenticated;
grant execute on function private.role_of(uuid) to authenticated;

-- Grants (new tables are not exposed by default) + RLS.
alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_roles enable row level security;
revoke all on table public.profiles, public.workspaces, public.workspace_roles from anon, authenticated;
grant select on table public.profiles, public.workspaces, public.workspace_roles to authenticated;
grant update (display_name, locale, last_workspace_id) on table public.profiles to authenticated;
grant update (name, timezone, locale) on table public.workspaces to authenticated;
grant all on table public.profiles, public.workspaces, public.workspace_roles to service_role;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (last_workspace_id is null or private.is_member(last_workspace_id))
  );

create policy workspaces_select_members on public.workspaces
  for select to authenticated
  using (private.is_member(id));
create policy workspaces_update_admins on public.workspaces
  for update to authenticated
  using (private.is_member(id, array['owner', 'admin']::public.workspace_role[]))
  with check (private.is_member(id, array['owner', 'admin']::public.workspace_role[]));

create policy workspace_roles_select_members on public.workspace_roles
  for select to authenticated
  using (private.is_member(workspace_id));

-- Membership writes only through functions (spec §6, §11 SECURITY DEFINER exception).
create function public.create_workspace(p_name text, p_slug text, p_timezone text)
returns public.workspaces
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_workspace public.workspaces;
begin
  if v_user is null then
    raise exception 'tn:unauthenticated' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if (select count(*) from public.workspace_roles r where r.user_id = v_user and r.role = 'owner')
      >= private.app_limit('workspaces_owned_max') then
    raise exception 'tn:workspace_limit' using errcode = 'P0001';
  end if;
  if not private.hit_rate_limit('workspace_create:user:' || v_user, private.app_limit('workspace_create_per_hour'), interval '1 hour') then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;
  insert into public.workspaces (name, slug, timezone)
  values (btrim(p_name), p_slug, p_timezone)
  returning * into v_workspace;
  insert into public.workspace_roles (workspace_id, user_id, role) values (v_workspace.id, v_user, 'owner');
  update public.profiles set last_workspace_id = v_workspace.id where user_id = v_user;
  return v_workspace;
end;
$$;

create function public.list_members(p_workspace uuid)
returns table (
  user_id uuid,
  role public.workspace_role,
  can_check_in boolean,
  display_name text,
  avatar_url text,
  email text,
  joined_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_member(p_workspace) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  return query
    select r.user_id, r.role, r.can_check_in, p.display_name, p.avatar_url, u.email::text, r.created_at
    from public.workspace_roles r
    join auth.users u on u.id = r.user_id
    left join public.profiles p on p.user_id = r.user_id
    where r.workspace_id = p_workspace
    order by r.role, coalesce(p.display_name, u.email::text);
end;
$$;

-- Pre-auth limit (OTP requests per IP). Called only by the server with the secret key.
create function public.check_ip_rate_limit(p_action text, p_ip text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_action <> 'otp_send' or char_length(coalesce(p_ip, '')) not between 1 and 64 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return private.hit_rate_limit('otp_send:ip:' || p_ip, private.app_limit('otp_send_per_ip_per_hour'), interval '1 hour');
end;
$$;

revoke execute on function public.create_workspace(text, text, text) from public, anon;
revoke execute on function public.list_members(uuid) from public, anon;
revoke execute on function public.check_ip_rate_limit(text, text) from public, anon, authenticated;
grant execute on function public.create_workspace(text, text, text) to authenticated;
grant execute on function public.list_members(uuid) to authenticated;
grant execute on function public.check_ip_rate_limit(text, text) to service_role;
