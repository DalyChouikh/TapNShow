-- M3 (#87, spec §11): SECURITY DEFINER bodies move to the non-exposed private schema; the Data
-- API sees only SECURITY INVOKER wrappers with the same signatures. Effective security is
-- unchanged (each body still checks auth.uid() and the caller's role); advisor lint 0029
-- (authenticated_security_definer_function_executable) stops firing.

alter function public.create_workspace(text, text, text) set schema private;
alter function public.list_members(uuid) set schema private;
alter function public.check_ip_rate_limit(text, text) set schema private;
alter function public.change_role(uuid, uuid, public.workspace_role, boolean) set schema private;
alter function public.remove_member(uuid, uuid) set schema private;
alter function public.leave_workspace(uuid) set schema private;
alter function public.transfer_ownership(uuid, uuid, text) set schema private;
alter function public.delete_workspace(uuid, text) set schema private;
alter function public.create_invite(uuid, text, public.workspace_role, text) set schema private;
alter function public.renew_invite(uuid, text) set schema private;
alter function public.revoke_invite(uuid) set schema private;
alter function public.consume_invite_email(uuid) set schema private;
alter function public.invite_preview(text) set schema private;
alter function public.accept_invite(text) set schema private;

create function public.create_workspace(p_name text, p_slug text, p_timezone text)
returns public.workspaces language sql security invoker set search_path = ''
as $$ select * from private.create_workspace(p_name, p_slug, p_timezone) $$;

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
language sql stable security invoker set search_path = ''
as $$ select * from private.list_members(p_workspace) $$;

create function public.check_ip_rate_limit(p_action text, p_ip text)
returns boolean language sql security invoker set search_path = ''
as $$ select private.check_ip_rate_limit(p_action, p_ip) $$;

create function public.change_role(p_workspace uuid, p_user uuid, p_role public.workspace_role, p_can_check_in boolean)
returns void language sql security invoker set search_path = ''
as $$ select private.change_role(p_workspace, p_user, p_role, p_can_check_in) $$;

create function public.remove_member(p_workspace uuid, p_user uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.remove_member(p_workspace, p_user) $$;

create function public.leave_workspace(p_workspace uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.leave_workspace(p_workspace) $$;

create function public.transfer_ownership(p_workspace uuid, p_new_owner uuid, p_confirm_name text)
returns void language sql security invoker set search_path = ''
as $$ select private.transfer_ownership(p_workspace, p_new_owner, p_confirm_name) $$;

create function public.delete_workspace(p_workspace uuid, p_confirm_name text)
returns void language sql security invoker set search_path = ''
as $$ select private.delete_workspace(p_workspace, p_confirm_name) $$;

create function public.create_invite(p_workspace uuid, p_email text, p_role public.workspace_role, p_token_hash text)
returns uuid language sql security invoker set search_path = ''
as $$ select private.create_invite(p_workspace, p_email, p_role, p_token_hash) $$;

create function public.renew_invite(p_invite uuid, p_token_hash text)
returns void language sql security invoker set search_path = ''
as $$ select private.renew_invite(p_invite, p_token_hash) $$;

create function public.revoke_invite(p_invite uuid)
returns void language sql security invoker set search_path = ''
as $$ select private.revoke_invite(p_invite) $$;

create function public.consume_invite_email(p_workspace uuid)
returns boolean language sql security invoker set search_path = ''
as $$ select private.consume_invite_email(p_workspace) $$;

create function public.invite_preview(p_token_hash text)
returns table (status text, workspace_name text, workspace_slug text, role public.workspace_role, masked_email text)
language sql stable security invoker set search_path = ''
as $$ select * from private.invite_preview(p_token_hash) $$;

create function public.accept_invite(p_token_hash text)
returns text language sql security invoker set search_path = ''
as $$ select private.accept_invite(p_token_hash) $$;

-- Supabase's default privileges grant new public functions to anon; take that back.
revoke execute on function
  public.create_workspace(text, text, text),
  public.list_members(uuid),
  public.check_ip_rate_limit(text, text),
  public.change_role(uuid, uuid, public.workspace_role, boolean),
  public.remove_member(uuid, uuid),
  public.leave_workspace(uuid),
  public.transfer_ownership(uuid, uuid, text),
  public.delete_workspace(uuid, text),
  public.create_invite(uuid, text, public.workspace_role, text),
  public.renew_invite(uuid, text),
  public.revoke_invite(uuid),
  public.consume_invite_email(uuid),
  public.invite_preview(text),
  public.accept_invite(text)
from public, anon;
revoke execute on function public.check_ip_rate_limit(text, text) from authenticated;
grant execute on function
  public.create_workspace(text, text, text),
  public.list_members(uuid),
  public.change_role(uuid, uuid, public.workspace_role, boolean),
  public.remove_member(uuid, uuid),
  public.leave_workspace(uuid),
  public.transfer_ownership(uuid, uuid, text),
  public.delete_workspace(uuid, text),
  public.create_invite(uuid, text, public.workspace_role, text),
  public.renew_invite(uuid, text),
  public.revoke_invite(uuid),
  public.consume_invite_email(uuid),
  public.invite_preview(text),
  public.accept_invite(text)
to authenticated;
grant execute on function public.check_ip_rate_limit(text, text) to service_role;

-- Functions created in private after M2's first migration kept PostgreSQL's default EXECUTE for
-- PUBLIC. Trigger functions need no EXECUTE at fire time; everything signed-in users reach is
-- granted explicitly (is_member, role_of and the bodies above), so close the default.
revoke execute on all functions in schema private from public, anon;
