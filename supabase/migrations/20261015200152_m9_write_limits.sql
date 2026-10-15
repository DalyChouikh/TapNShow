-- M9 (spec §10 Route registries, §11 Rate limiting): every write and every pre-sign-in route
-- has its own limit. Values are per user per hour unless named per IP.
insert into private.app_limits (name, value) values
  ('contact_writes_per_user_per_hour', 600),
  ('list_writes_per_user_per_hour', 300),
  ('meeting_writes_per_user_per_hour', 600),
  ('workspace_writes_per_user_per_hour', 120),
  ('profile_writes_per_user_per_hour', 300),
  ('google_disconnects_per_user_per_hour', 20),
  ('invite_accepts_per_user_per_hour', 30),
  ('invite_previews_per_user_per_hour', 120),
  ('invite_creates_per_user_per_hour', 200),
  ('invite_renewals_per_user_per_hour', 100),
  ('invite_revokes_per_user_per_hour', 200),
  ('audience_sets_per_user_per_hour', 600),
  ('meeting_cancels_per_user_per_hour', 30),
  ('meeting_deletes_per_user_per_hour', 60),
  ('meeting_sends_per_user_per_hour', 60),
  ('meeting_nudges_per_user_per_hour', 30),
  ('member_changes_per_user_per_hour', 120),
  ('workspace_deletions_per_user_per_hour', 10),
  ('sender_sets_per_user_per_hour', 30),
  ('ownership_transfers_per_user_per_hour', 10),
  ('sheet_offs_per_user_per_hour', 20),
  ('otp_verify_per_ip_per_hour', 120),
  ('google_signin_per_ip_per_hour', 120);

-- Review Focus 1 (shared campus Wi-Fi): 100 members answering from one IP make about 3 token
-- requests each. 120 per IP per hour blocked the 41st member; the per-token limit (30) still
-- stops a single link from being hammered.
update private.app_limits set value = 1500 where name = 'token_requests_per_ip_per_hour';

-- Copied from 20261015092518_m8_minors.sql; adds the M9 actions.
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
  end;
begin
  if v_user is null or v_limit_name is null then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return private.hit_rate_limit(p_action || ':user:' || v_user::text, private.app_limit(v_limit_name), interval '1 hour');
end;
$$;

-- Spends one unit of the caller's budget for p_action or refuses (wrappers call it first).
create function private.require_user_limit(p_action text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.hit_user_rate_limit(p_action) then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;
end;
$$;
revoke execute on function private.require_user_limit(text) from public, anon;
grant execute on function private.require_user_limit(text) to authenticated;

-- Pre-sign-in routes, per IP (was otp_send only; same key format).
create or replace function private.check_ip_rate_limit(p_action text, p_ip text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit_name text := case p_action
    when 'otp_send' then 'otp_send_per_ip_per_hour'
    when 'otp_verify' then 'otp_verify_per_ip_per_hour'
    when 'google_signin' then 'google_signin_per_ip_per_hour'
  end;
begin
  if v_limit_name is null or char_length(coalesce(p_ip, '')) not between 1 and 64 then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  return private.hit_rate_limit(p_action || ':ip:' || p_ip, private.app_limit(v_limit_name), interval '1 hour');
end;
$$;

-- Direct writes by signed-in people (RLS writes through the Data API, and SECURITY INVOKER
-- functions): one unit per transaction per action, however many statements it runs. SECURITY
-- DEFINER functions run as their owner (current_user <> 'authenticated') and keep their own limits.
-- SECURITY INVOKER on purpose: in a definer function current_user would always be the owner.
create function private.limit_direct_writes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if current_user = 'authenticated'
     and pg_catalog.current_setting('tn.counted.' || tg_argv[0], true) is distinct from 'on' then
    if not private.hit_user_rate_limit(tg_argv[0]) then
      raise exception 'tn:rate_limited' using errcode = 'P0001';
    end if;
    perform pg_catalog.set_config('tn.counted.' || tg_argv[0], 'on', true);
  end if;
  return null;
end;
$$;
revoke execute on function private.limit_direct_writes() from public, anon, authenticated;

create trigger contacts_limit_writes before insert or update or delete on public.contacts
  for each statement execute function private.limit_direct_writes('contact_write');
create trigger list_contacts_limit_writes before insert or update or delete on public.list_contacts
  for each statement execute function private.limit_direct_writes('contact_write');
create trigger lists_limit_writes before insert or update or delete on public.lists
  for each statement execute function private.limit_direct_writes('list_write');
create trigger meetings_limit_writes before insert or update or delete on public.meetings
  for each statement execute function private.limit_direct_writes('meeting_write');
create trigger workspaces_limit_writes before insert or update or delete on public.workspaces
  for each statement execute function private.limit_direct_writes('workspace_write');
create trigger profiles_limit_writes before insert or update or delete on public.profiles
  for each statement execute function private.limit_direct_writes('profile_write');

-- Thin wrappers over SECURITY DEFINER bodies: the limit first, then the unchanged body.
-- create or replace keeps each wrapper's grants (authenticated only).
create or replace function public.accept_invite(p_token_hash text)
returns text language sql security invoker set search_path = ''
as $$ select private.require_user_limit('invite_accept'); select private.accept_invite(p_token_hash) $$;

create or replace function public.invite_preview(p_token_hash text)
returns table (status text, workspace_name text, workspace_slug text, role public.workspace_role, masked_email text)
language sql volatile security invoker set search_path = ''
as $$ select private.require_user_limit('invite_preview'); select * from private.invite_preview(p_token_hash) $$;

create or replace function public.create_invite(p_workspace uuid, p_email text, p_role public.workspace_role, p_token_hash text)
returns uuid language sql security invoker set search_path = ''
as $$ select private.require_user_limit('invite_create'); select private.create_invite(p_workspace, p_email, p_role, p_token_hash) $$;

create or replace function public.renew_invite(p_invite uuid, p_token_hash text)
returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('invite_renew'); select private.renew_invite(p_invite, p_token_hash) $$;

create or replace function public.revoke_invite(p_invite uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('invite_revoke'); select private.revoke_invite(p_invite) $$;

create or replace function public.change_role(p_workspace uuid, p_user uuid, p_role public.workspace_role, p_can_check_in boolean)
returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('member_change'); select private.change_role(p_workspace, p_user, p_role, p_can_check_in) $$;

create or replace function public.remove_member(p_workspace uuid, p_user uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('member_change'); select private.remove_member(p_workspace, p_user) $$;

create or replace function public.leave_workspace(p_workspace uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('member_change'); select private.leave_workspace(p_workspace) $$;

create or replace function public.transfer_ownership(p_workspace uuid, p_new_owner uuid, p_confirm_name text)
returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('ownership_transfer'); select private.transfer_ownership(p_workspace, p_new_owner, p_confirm_name) $$;

create or replace function public.delete_workspace(p_workspace uuid, p_confirm_name text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.require_user_limit('workspace_delete'); select private.delete_workspace(p_workspace, p_confirm_name) $$;

create or replace function public.set_meeting_audience(p_meeting uuid, p_list_ids uuid[], p_include uuid[], p_exclude uuid[])
returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('audience_set'); select private.set_meeting_audience(p_meeting, p_list_ids, p_include, p_exclude) $$;

create or replace function public.send_meeting(p_meeting uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.require_user_limit('meeting_send'); select private.send_meeting(p_meeting) $$;

create or replace function public.cancel_meeting(p_meeting uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.require_user_limit('meeting_cancel'); select private.cancel_meeting(p_meeting) $$;

create or replace function public.delete_cancelled_meeting(p_meeting uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('meeting_delete'); select private.delete_cancelled_meeting(p_meeting) $$;

create or replace function public.nudge_meeting(p_meeting uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.require_user_limit('meeting_nudge'); select private.nudge_meeting(p_meeting) $$;

create or replace function public.set_workspace_sender(p_workspace uuid, p_connection uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.require_user_limit('sender_set'); select private.set_workspace_sender(p_workspace, p_connection) $$;

create or replace function public.turn_off_sheet(p_workspace uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.require_user_limit('sheet_off'); select private.turn_off_sheet(p_workspace) $$;

create or replace function public.disconnect_google_connection(p_connection uuid)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.require_user_limit('google_disconnect'); select private.disconnect_google_connection(p_connection) $$;
