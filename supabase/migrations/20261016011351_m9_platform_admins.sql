-- M9 (spec §6, §7.19): platform admins, their email-bound invites, and the append-only platform
-- event log that is also the outbox for #platform and Owner emails (drained in Task 17).
create type public.platform_role as enum ('owner', 'admin');
create type public.platform_event_kind as enum (
  'auto_suspended', 'suspended', 'lifted', 'report', 'report_reviewed', 'admin_invited',
  'admin_joined', 'admin_removed', 'invite_revoked', 'owner_set', 'platform_email_cap', 'worker_failing'
);

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role public.platform_role not null default 'admin',
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default pg_catalog.now()
);
create unique index platform_admins_one_owner on public.platform_admins (role) where role = 'owner';
alter table public.platform_admins enable row level security;
revoke all on table public.platform_admins from anon, authenticated;

create table public.platform_admin_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(btrim(email)) and char_length(email) <= 254),
  token_hash text not null unique,
  invited_by uuid references auth.users (id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now()
);
create unique index platform_admin_invites_one_open on public.platform_admin_invites (email)
  where accepted_at is null and revoked_at is null;
alter table public.platform_admin_invites enable row level security;
revoke all on table public.platform_admin_invites from anon, authenticated;

create table public.platform_events (
  id bigint generated always as identity primary key,
  kind public.platform_event_kind not null,
  workspace_id uuid references public.workspaces (id) on delete set null,
  workspace_name text,
  actor_id uuid references auth.users (id) on delete set null,
  facts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  notified_at timestamptz,
  notify_attempts integer not null default 0,
  locked_until timestamptz
);
create index platform_events_log_idx on public.platform_events (created_at desc, id desc);
create index platform_events_unsent_idx on public.platform_events (id) where notified_at is null;
alter table public.platform_events enable row level security;
revoke all on table public.platform_events from anon, authenticated;

insert into private.app_limits (name, value) values
  ('admin_writes_per_user_per_hour', 300),
  ('admin_invites_per_user_per_hour', 50),
  ('admin_invite_accepts_per_user_per_hour', 30),
  ('admin_invite_previews_per_user_per_hour', 120),
  ('platform_notify_attempts_max', 5);

-- The action → limit map: copied from 20261015200152_m9_write_limits.sql, plus the admin actions.
create or replace function private.hit_user_rate_limit(p_action text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_limit_name text := case p_action
    when 'import' then 'imports_per_user_per_hour'
    when 'import_preview' then 'import_previews_per_user_per_hour'
    when 'contact_add' then 'contact_adds_per_user_per_hour'
    when 'meeting_create' then 'meetings_per_user_per_hour'
    when 'meeting_people_add' then 'meeting_people_adds_per_user_per_hour'
    when 'meeting_edit_email' then 'meeting_email_edits_per_user_per_hour'
    when 'sheet_retry' then 'sheet_retries_per_user_per_hour'
    when 'google_connect' then 'google_connects_per_user_per_hour'
    when 'check_in_mark' then 'check_in_marks_per_user_per_hour'
    when 'check_in_rest' then 'check_in_rests_per_user_per_hour'
    when 'invite_link' then 'invite_links_per_user_per_hour'
    when 'answers_download' then 'answer_downloads_per_user_per_hour'
    when 'account_delete' then 'account_deletions_per_user_per_hour'
    when 'push_subscribe' then 'push_subscribes_per_user_per_hour'
    when 'push_unsubscribe' then 'push_unsubscribes_per_user_per_hour'
    when 'contact_write' then 'contact_writes_per_user_per_hour'
    when 'list_write' then 'list_writes_per_user_per_hour'
    when 'meeting_write' then 'meeting_writes_per_user_per_hour'
    when 'workspace_write' then 'workspace_writes_per_user_per_hour'
    when 'profile_write' then 'profile_writes_per_user_per_hour'
    when 'google_disconnect' then 'google_disconnects_per_user_per_hour'
    when 'invite_accept' then 'invite_accepts_per_user_per_hour'
    when 'invite_preview' then 'invite_previews_per_user_per_hour'
    when 'invite_create' then 'invite_creates_per_user_per_hour'
    when 'invite_renew' then 'invite_renewals_per_user_per_hour'
    when 'invite_revoke' then 'invite_revokes_per_user_per_hour'
    when 'audience_set' then 'audience_sets_per_user_per_hour'
    when 'meeting_cancel' then 'meeting_cancels_per_user_per_hour'
    when 'meeting_delete' then 'meeting_deletes_per_user_per_hour'
    when 'meeting_send' then 'meeting_sends_per_user_per_hour'
    when 'meeting_nudge' then 'meeting_nudges_per_user_per_hour'
    when 'member_change' then 'member_changes_per_user_per_hour'
    when 'workspace_delete' then 'workspace_deletions_per_user_per_hour'
    when 'sender_set' then 'sender_sets_per_user_per_hour'
    when 'ownership_transfer' then 'ownership_transfers_per_user_per_hour'
    when 'sheet_off' then 'sheet_offs_per_user_per_hour'
    when 'admin_write' then 'admin_writes_per_user_per_hour'
    when 'admin_invite' then 'admin_invites_per_user_per_hour'
    when 'admin_invite_accept' then 'admin_invite_accepts_per_user_per_hour'
    when 'admin_invite_preview' then 'admin_invite_previews_per_user_per_hour'
  end;
begin
  if v_user is null or v_limit_name is null then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return private.hit_rate_limit(p_action || ':user:' || v_user::text, private.app_limit(v_limit_name), interval '1 hour');
end;
$$;

create function private.platform_role_of(p_user uuid)
returns public.platform_role
language sql
stable
security definer
set search_path = ''
as $$ select a.role from public.platform_admins a where a.user_id = p_user $$;
revoke execute on function private.platform_role_of(uuid) from public, anon, authenticated;

-- Not an admin and not the owner both look like "nothing here" (spec §7.19).
create function private.require_platform_role(p_owner_only boolean)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.platform_role := private.platform_role_of(auth.uid());
begin
  if v_role is null or (p_owner_only and v_role <> 'owner') then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function private.require_platform_role(boolean) from public, anon, authenticated;

-- One log line (and outbox row for #platform). Keeps the workspace's name, so the line survives
-- the workspace being deleted.
create function private.record_platform_event(
  p_kind public.platform_event_kind, p_workspace uuid, p_actor uuid, p_facts jsonb
)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into public.platform_events (kind, workspace_id, workspace_name, actor_id, facts)
  values (p_kind, p_workspace, (select w.name from public.workspaces w where w.id = p_workspace), p_actor, coalesce(p_facts, '{}'::jsonb))
  returning id
$$;
revoke execute on function private.record_platform_event(public.platform_event_kind, uuid, uuid, jsonb) from public, anon, authenticated;

create function private.my_platform_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$ select private.platform_role_of(auth.uid())::text $$;

create function private.admin_admins()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_role(false);
  return pg_catalog.jsonb_build_object(
    'admins', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'user_id', a.user_id, 'role', a.role, 'name', p.display_name,
          'email', private.mask_email(lower(u.email)), 'since', a.created_at)
        order by (a.role = 'owner') desc, a.created_at)
      from public.platform_admins a
      join auth.users u on u.id = a.user_id
      left join public.profiles p on p.user_id = a.user_id), '[]'::jsonb),
    'invites', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id', i.id, 'email', private.mask_email(i.email), 'expires_at', i.expires_at)
        order by i.created_at desc)
      from public.platform_admin_invites i
      where i.accepted_at is null and i.revoked_at is null), '[]'::jsonb)
  );
end;
$$;

create function private.admin_invite(p_email text, p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id uuid;
  v_expires timestamptz := pg_catalog.now() + pg_catalog.make_interval(days => private.app_limit('invite_expiry_days'));
begin
  perform private.require_platform_role(true);
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' or char_length(v_email) > 254 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.platform_admins a join auth.users u on u.id = a.user_id where lower(u.email) = v_email) then
    raise exception 'tn:already_member' using errcode = 'P0001';
  end if;
  update public.platform_admin_invites set revoked_at = pg_catalog.now(), updated_at = pg_catalog.now()
  where email = v_email and accepted_at is null and revoked_at is null;
  insert into public.platform_admin_invites (email, token_hash, invited_by, expires_at)
  values (v_email, p_token_hash, auth.uid(), v_expires)
  returning id into v_id;
  perform private.record_platform_event('admin_invited', null, auth.uid(),
    pg_catalog.jsonb_build_object('email', private.mask_email(v_email)));
  return pg_catalog.jsonb_build_object('id', v_id, 'expires_at', v_expires);
end;
$$;

create function private.admin_invite_renew(p_invite uuid, p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.platform_admin_invites;
begin
  perform private.require_platform_role(true);
  update public.platform_admin_invites
  set token_hash = p_token_hash, updated_at = pg_catalog.now(),
    expires_at = pg_catalog.now() + pg_catalog.make_interval(days => private.app_limit('invite_expiry_days'))
  where id = p_invite and accepted_at is null and revoked_at is null
  returning * into v_invite;
  if v_invite.id is null then
    raise exception 'tn:invite_closed' using errcode = 'P0001';
  end if;
  return pg_catalog.jsonb_build_object('id', v_invite.id, 'email', v_invite.email, 'expires_at', v_invite.expires_at);
end;
$$;

create function private.admin_invite_revoke(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  perform private.require_platform_role(true);
  update public.platform_admin_invites set revoked_at = pg_catalog.now(), updated_at = pg_catalog.now()
  where id = p_invite and accepted_at is null and revoked_at is null
  returning email into v_email;
  if v_email is null then
    raise exception 'tn:invite_closed' using errcode = 'P0001';
  end if;
  perform private.record_platform_event('invite_revoked', null, auth.uid(),
    pg_catalog.jsonb_build_object('email', private.mask_email(v_email)));
end;
$$;

create function private.admin_remove(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.platform_role;
  v_email text;
begin
  perform private.require_platform_role(true);
  select a.role, lower(u.email) into v_role, v_email
  from public.platform_admins a join auth.users u on u.id = a.user_id where a.user_id = p_user;
  if v_role is null then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  if v_role = 'owner' then
    raise exception 'tn:forbidden' using errcode = 'P0001';
  end if;
  delete from public.platform_admins where user_id = p_user;
  perform private.record_platform_event('admin_removed', null, auth.uid(),
    pg_catalog.jsonb_build_object('email', private.mask_email(v_email)));
end;
$$;

-- The platform's daily email budget, spent per admin invite email (as for workspace invites).
create function private.consume_admin_invite_email()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_platform_role(true);
  return private.hit_rate_limit('invite_email:platform', private.app_limit('invite_email_platform_per_day'), interval '24 hours');
end;
$$;

create function private.admin_invite_status(p_invite public.platform_admin_invites)
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
  if private.platform_role_of(auth.uid()) is not null then
    return 'already_admin';
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
revoke execute on function private.admin_invite_status(public.platform_admin_invites) from public, anon, authenticated;

create function private.admin_invite_preview(p_token_hash text)
returns table (status text, masked_email text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_invite public.platform_admin_invites;
begin
  if auth.uid() is null then
    raise exception 'tn:unauthenticated' using errcode = 'P0001';
  end if;
  select * into v_invite from public.platform_admin_invites i where i.token_hash = p_token_hash;
  if v_invite.id is null then
    return query select 'not_found'::text, null::text;
    return;
  end if;
  return query select private.admin_invite_status(v_invite), private.mask_email(v_invite.email);
end;
$$;

create function private.accept_admin_invite(p_token_hash text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.platform_admin_invites;
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'tn:unauthenticated' using errcode = 'P0001';
  end if;
  select * into v_invite from public.platform_admin_invites i where i.token_hash = p_token_hash for update;
  if v_invite.id is null then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  v_status := private.admin_invite_status(v_invite);
  if v_status = 'already_admin' then
    raise exception 'tn:invite_already_member' using errcode = 'P0001';
  end if;
  if v_status <> 'ready' then
    raise exception '%', 'tn:invite_' || v_status using errcode = 'P0001';
  end if;
  insert into public.platform_admins (user_id, role, added_by) values (auth.uid(), 'admin', v_invite.invited_by);
  update public.platform_admin_invites set accepted_at = pg_catalog.now(), accepted_by = auth.uid(), updated_at = pg_catalog.now()
  where id = v_invite.id;
  perform private.record_platform_event('admin_joined', null, auth.uid(),
    pg_catalog.jsonb_build_object('email', private.mask_email(v_invite.email)));
end;
$$;

-- The owner is set by scripts/set-platform-owner.ts only (never the UI, never a migration: the
-- repo is public). Exactly one owner; --replace turns the old one into an admin.
create function private.set_platform_owner(p_email text, p_replace boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_current uuid;
begin
  select u.id into v_user from auth.users u
  where lower(u.email) = lower(btrim(p_email)) and u.email_confirmed_at is not null;
  if v_user is null then
    raise exception 'tn:not_found' using errcode = 'P0001';
  end if;
  select a.user_id into v_current from public.platform_admins a where a.role = 'owner' for update;
  if v_current = v_user then
    return 'unchanged';
  end if;
  if v_current is not null then
    if not coalesce(p_replace, false) then
      raise exception 'tn:conflict' using errcode = 'P0001';
    end if;
    update public.platform_admins set role = 'admin' where user_id = v_current;
  end if;
  insert into public.platform_admins (user_id, role) values (v_user, 'owner')
  on conflict (user_id) do update set role = 'owner';
  perform private.record_platform_event('owner_set', null, null,
    pg_catalog.jsonb_build_object('replaced', v_current is not null));
  return 'set';
end;
$$;
revoke execute on function private.set_platform_owner(text, boolean) from public, anon, authenticated, service_role;

create function private.refuse_platform_owner_deletion()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.platform_role_of(auth.uid()) = 'owner' then
    raise exception 'tn:platform_owner' using errcode = 'P0001';
  end if;
end;
$$;

-- Wrappers: the limit first, then the body.
create function public.my_platform_role() returns text language sql stable security invoker set search_path = ''
as $$ select private.my_platform_role() $$;
create function public.admin_admins() returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.admin_admins() $$;
create function public.admin_invite(p_email text, p_token_hash text) returns jsonb language sql security invoker set search_path = ''
as $$ select private.require_user_limit('admin_invite'); select private.admin_invite(p_email, p_token_hash) $$;
create function public.admin_invite_renew(p_invite uuid, p_token_hash text) returns jsonb language sql security invoker set search_path = ''
as $$ select private.require_user_limit('admin_invite'); select private.admin_invite_renew(p_invite, p_token_hash) $$;
create function public.admin_invite_revoke(p_invite uuid) returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('admin_write'); select private.admin_invite_revoke(p_invite) $$;
create function public.admin_remove(p_user uuid) returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('admin_write'); select private.admin_remove(p_user) $$;
create function public.consume_admin_invite_email() returns boolean language sql security invoker set search_path = ''
as $$ select private.consume_admin_invite_email() $$;
create function public.admin_invite_preview(p_token_hash text) returns table (status text, masked_email text)
language sql volatile security invoker set search_path = ''
as $$ select private.require_user_limit('admin_invite_preview'); select * from private.admin_invite_preview(p_token_hash) $$;
create function public.accept_admin_invite(p_token_hash text) returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('admin_invite_accept'); select private.accept_admin_invite(p_token_hash) $$;

create or replace function public.delete_account(p_confirm text) returns jsonb language sql security invoker set search_path = ''
as $$ select private.refuse_platform_owner_deletion(); select private.delete_account(p_confirm) $$;

revoke execute on function
  private.my_platform_role(), private.admin_admins(), private.admin_invite(text, text),
  private.admin_invite_renew(uuid, text), private.admin_invite_revoke(uuid), private.admin_remove(uuid),
  private.consume_admin_invite_email(), private.admin_invite_preview(text), private.accept_admin_invite(text),
  private.refuse_platform_owner_deletion(),
  public.my_platform_role(), public.admin_admins(), public.admin_invite(text, text),
  public.admin_invite_renew(uuid, text), public.admin_invite_revoke(uuid), public.admin_remove(uuid),
  public.consume_admin_invite_email(), public.admin_invite_preview(text), public.accept_admin_invite(text)
from public, anon;
grant execute on function
  private.my_platform_role(), private.admin_admins(), private.admin_invite(text, text),
  private.admin_invite_renew(uuid, text), private.admin_invite_revoke(uuid), private.admin_remove(uuid),
  private.consume_admin_invite_email(), private.admin_invite_preview(text), private.accept_admin_invite(text),
  private.refuse_platform_owner_deletion(),
  public.my_platform_role(), public.admin_admins(), public.admin_invite(text, text),
  public.admin_invite_renew(uuid, text), public.admin_invite_revoke(uuid), public.admin_remove(uuid),
  public.consume_admin_invite_email(), public.admin_invite_preview(text), public.accept_admin_invite(text)
to authenticated;
