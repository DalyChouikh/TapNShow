-- M4 sender (spec §6 workspaces + Integrations, §7.15, §9 Google connection).

insert into private.app_limits (name, value) values ('gmail_sends_per_day', 400);

create type public.response_mode as enum ('announcement', 'rsvp', 'attendance');
create type public.location_mode as enum ('in_person', 'online', 'hybrid');
create type public.connection_status as enum ('active', 'broken');

-- CHECK constraints cannot hold subqueries, so the array rule lives in a function.
create function private.valid_delay_options(p_options smallint[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_options is not null
    and pg_catalog.cardinality(p_options) <= 6
    and not exists (select 1 from pg_catalog.unnest(p_options) as x(v) where x.v is null or x.v < 1 or x.v > 240)
    and pg_catalog.cardinality(p_options) = (select count(distinct x.v) from pg_catalog.unnest(p_options) as x(v));
$$;

create table public.google_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  google_sub text not null check (char_length(google_sub) between 1 and 255),
  google_email text not null check (google_email = lower(btrim(google_email)) and private.is_valid_email(google_email)),
  granted_scopes text[] not null,
  refresh_token_encrypted text not null,
  status public.connection_status not null default 'active',
  broken_reason text check (broken_reason is null or char_length(broken_reason) <= 200),
  broken_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, google_sub)
);
create index google_connections_sub_idx on public.google_connections (google_sub);
create trigger google_connections_set_updated_at
  before update on public.google_connections
  for each row execute function private.set_updated_at();

alter table public.workspaces
  add column sender_connection_id uuid references public.google_connections (id) on delete set null,
  add column default_response_mode public.response_mode not null default 'attendance',
  add column default_delay_options smallint[] not null default '{5,10,15,30}'
    check (private.valid_delay_options(default_delay_options)),
  add column default_reason_required boolean not null default true,
  add column default_comments_enabled boolean not null default false,
  add column default_footer_note text not null default ''
    check (default_footer_note = btrim(default_footer_note) and char_length(default_footer_note) <= 280),
  add column default_duration_minutes smallint not null default 60
    check (default_duration_minutes between 5 and 720);
create index workspaces_sender_idx on public.workspaces (sender_connection_id);

-- One row per email reserved or sent (spec §8 quotas), counted per Google account.
create table public.send_log (
  id bigint generated always as identity primary key,
  google_sub text not null,
  workspace_id uuid references public.workspaces (id) on delete set null,
  job_id uuid,
  sent_at timestamptz not null default now()
);
create index send_log_sub_time_idx on public.send_log (google_sub, sent_at);
create unique index send_log_job_idx on public.send_log (job_id) where job_id is not null;

alter table public.google_connections enable row level security;
alter table public.send_log enable row level security;
revoke all on table public.google_connections, public.send_log from anon, authenticated;
grant select (id, user_id, google_sub, google_email, granted_scopes, status, broken_reason, broken_at, created_at, updated_at)
  on table public.google_connections to authenticated;
grant all on table public.google_connections, public.send_log to service_role;
grant update (default_response_mode, default_delay_options, default_reason_required, default_comments_enabled,
              default_footer_note, default_duration_minutes)
  on table public.workspaces to authenticated;

create policy google_connections_select_own on public.google_connections
  for select to authenticated using (user_id = (select auth.uid()));

create function private.save_google_connection(
  p_google_sub text,
  p_google_email text,
  p_scopes text[],
  p_token_encrypted text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
begin
  if v_user is null then
    raise exception 'tn:unauthenticated' using errcode = 'P0001';
  end if;
  if not ('https://www.googleapis.com/auth/gmail.send' = any (coalesce(p_scopes, '{}'))) then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  insert into public.google_connections (user_id, google_sub, google_email, granted_scopes, refresh_token_encrypted)
  values (v_user, p_google_sub, lower(btrim(p_google_email)), p_scopes, p_token_encrypted)
  on conflict (user_id, google_sub) do update set
    google_email = excluded.google_email,
    granted_scopes = excluded.granted_scopes,
    refresh_token_encrypted = excluded.refresh_token_encrypted,
    status = 'active',
    broken_reason = null,
    broken_at = null
  returning id into v_id;
  return v_id;
end;
$$;

create function private.set_workspace_sender(p_workspace uuid, p_connection uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.role_of(p_workspace) is distinct from 'owner' then
    if private.is_member(p_workspace) then
      raise exception 'tn:owner_only' using errcode = 'P0001';
    end if;
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.google_connections c
    where c.id = p_connection and c.user_id = auth.uid() and c.status = 'active'
  ) then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  update public.workspaces set sender_connection_id = p_connection where id = p_workspace;
end;
$$;

create function private.disconnect_google_connection(p_connection uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
  v_sub text;
begin
  delete from public.google_connections c
  where c.id = p_connection and c.user_id = auth.uid()
  returning c.refresh_token_encrypted, c.google_sub into v_token, v_sub;
  if v_token is null then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  return pg_catalog.jsonb_build_object('refresh_token_encrypted', v_token, 'google_sub', v_sub);
end;
$$;

create function private.workspace_sender(p_workspace uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if not private.is_member(p_workspace) then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  return pg_catalog.jsonb_build_object(
    'sender', (
      select pg_catalog.jsonb_build_object(
        'connection_id', c.id,
        'email', c.google_email,
        'status', c.status,
        'connected_by', coalesce(p.display_name, ''),
        'connected_at', c.updated_at,
        'is_mine', c.user_id = v_user,
        'sent_last_24h', (
          select count(*) from public.send_log s
          where s.google_sub = c.google_sub and s.sent_at > pg_catalog.now() - interval '24 hours'
        ),
        'daily_limit', private.app_limit('gmail_sends_per_day')
      )
      from public.workspaces w
      join public.google_connections c on c.id = w.sender_connection_id
      left join public.profiles p on p.user_id = c.user_id
      where w.id = p_workspace
    ),
    'owner_name', coalesce((
      select p.display_name from public.workspace_roles r
      left join public.profiles p on p.user_id = r.user_id
      where r.workspace_id = p_workspace and r.role = 'owner'
    ), ''),
    'my_connections', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', c.id,
          'email', c.google_email,
          'status', c.status,
          'used_by', coalesce((
            select pg_catalog.jsonb_agg(w.name order by w.name)
            from public.workspaces w where w.sender_connection_id = c.id
          ), '[]'::jsonb)
        )
        order by c.google_email
      )
      from public.google_connections c
      where c.user_id = v_user
    ), '[]'::jsonb)
  );
end;
$$;

create function public.save_google_connection(p_google_sub text, p_google_email text, p_scopes text[], p_token_encrypted text)
returns uuid language sql security invoker set search_path = ''
as $$ select private.save_google_connection(p_google_sub, p_google_email, p_scopes, p_token_encrypted) $$;

create function public.set_workspace_sender(p_workspace uuid, p_connection uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.set_workspace_sender(p_workspace, p_connection) $$;

create function public.disconnect_google_connection(p_connection uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.disconnect_google_connection(p_connection) $$;

create function public.workspace_sender(p_workspace uuid)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.workspace_sender(p_workspace) $$;

revoke execute on all functions in schema private from public, anon;
grant execute on function
  private.valid_delay_options(smallint[]),
  private.save_google_connection(text, text, text[], text),
  private.set_workspace_sender(uuid, uuid),
  private.disconnect_google_connection(uuid),
  private.workspace_sender(uuid)
to authenticated;
-- CHECK constraints run as the writing role (service role for test setup and the dispatcher).
grant execute on function private.valid_delay_options(smallint[]) to service_role;

revoke execute on function
  public.save_google_connection(text, text, text[], text),
  public.set_workspace_sender(uuid, uuid),
  public.disconnect_google_connection(uuid),
  public.workspace_sender(uuid)
from public, anon;
grant execute on function
  public.save_google_connection(text, text, text[], text),
  public.set_workspace_sender(uuid, uuid),
  public.disconnect_google_connection(uuid),
  public.workspace_sender(uuid)
to authenticated;
