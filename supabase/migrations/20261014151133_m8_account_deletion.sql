-- M8 account deletion (spec §7.4, §11 Account deletion). Latest sheet_pause body from
-- 20261011094523_m7_sheet_worker.sql; its alert cap moves into owner_alert_target so pausing a
-- sheet and deleting an account share one rule, and the once-a-day sheet alert moves into
-- sheet_alert_target for the same reason.

-- The Owner to tell about a workspace problem, inside the platform email cap (the M4 Viewer-invite
-- budget). Null when the cap is spent: the problem still shows in Settings.
create function private.owner_alert_target(p_workspace uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.hit_rate_limit('invite_email:platform', private.app_limit('invite_email_platform_per_day'), interval '24 hours') then
    return null;
  end if;
  return (
    select pg_catalog.jsonb_build_object('email', u.email, 'workspace_name', w.name, 'workspace_slug', w.slug)
    from public.workspaces w
    join public.workspace_roles r on r.workspace_id = w.id and r.role = 'owner'
    join auth.users u on u.id = r.user_id
    where w.id = p_workspace
  );
end;
$$;

-- At most one Owner email per paused sheet per day, inside the platform cap: the one sheet-alert
-- rule, shared by the sheet worker (sheet_pause) and account deletion.
create function private.sheet_alert_target(p_workspace uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target jsonb;
begin
  if exists (
    select 1 from public.sheet_syncs s
    where s.workspace_id = p_workspace and s.alerted_at > pg_catalog.now() - interval '24 hours'
  ) then
    return null;
  end if;
  v_target := private.owner_alert_target(p_workspace);
  if v_target is not null then
    update public.sheet_syncs set alerted_at = pg_catalog.now() where workspace_id = p_workspace;
  end if;
  return v_target;
end;
$$;

create or replace function private.sheet_pause(p_workspace uuid, p_run uuid, p_reason public.sheet_pause_reason)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paused uuid;
begin
  update public.sheet_syncs
  set status = 'paused', paused_reason = p_reason, paused_at = pg_catalog.now(), run_id = null, locked_until = null
  where workspace_id = p_workspace and run_id = p_run
  returning workspace_id into v_paused;
  if v_paused is null then
    return null;
  end if;
  return private.sheet_alert_target(p_workspace) || pg_catalog.jsonb_build_object('reason', p_reason);
end;
$$;

-- Delete my account, the database part (spec §11). The route then revokes the released tokens,
-- emails the alerts and deletes the auth user through the admin API (cascading to the profile and
-- push subscriptions). Calling it again after a failed admin call is harmless.
create function private.delete_account(p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_connections uuid[];
  v_alerts jsonb := '[]'::jsonb;
  v_target jsonb;
  v_row record;
begin
  if v_user is null then
    raise exception 'tn:unauthenticated' using errcode = 'P0001';
  end if;
  if p_confirm is distinct from 'confirm' then
    raise exception 'tn:name_mismatch' using errcode = 'P0001';
  end if;
  if not private.hit_user_rate_limit('account_delete') then
    raise exception 'tn:rate_limited' using errcode = 'P0001';
  end if;
  -- Lock the person's seats first: an ownership transfer to them (which needs an existing Admin
  -- seat) waits, then finds no seat.
  perform 1 from public.workspace_roles r where r.user_id = v_user for update;
  if exists (select 1 from public.workspace_roles r where r.user_id = v_user and r.role = 'owner') then
    raise exception 'tn:owns_workspaces' using errcode = 'P0001';
  end if;
  delete from public.workspace_roles r where r.user_id = v_user;

  -- Reasons and comments go everywhere; statuses and check-ins stay for the groups (the sheet
  -- triggers mark the years, so the Google Sheet drops the words at its next redraw).
  update public.responses r set reason = '', comment = ''
  where r.invitee_id in (
      select i.id from public.meeting_invitees i where i.contact_id in (select private.contacts_of(v_user)))
    and (r.reason <> '' or r.comment <> '');
  update public.response_history h set reason = '', comment = ''
  where h.invitee_id in (
      select i.id from public.meeting_invitees i where i.contact_id in (select private.contacts_of(v_user)))
    and (h.reason <> '' or h.comment <> '');

  select coalesce(pg_catalog.array_agg(c.id), '{}') into v_connections
  from public.google_connections c where c.user_id = v_user;

  for v_row in
    update public.workspaces w set sender_connection_id = null
    where w.sender_connection_id = any (v_connections)
    returning w.id
  loop
    v_target := private.owner_alert_target(v_row.id);
    if v_target is not null then
      v_alerts := v_alerts || pg_catalog.jsonb_build_array(v_target || pg_catalog.jsonb_build_object('kind', 'sender'));
    end if;
  end loop;

  -- The sheet keeps its account (google_sub/email) for "Pick that account"; only the link goes.
  for v_row in
    update public.sheet_syncs s
    set status = 'paused', paused_reason = 'access_lost', paused_at = pg_catalog.now(),
      run_id = null, locked_until = null, connection_id = null
    where s.connection_id = any (v_connections)
    returning s.workspace_id
  loop
    v_target := private.sheet_alert_target(v_row.workspace_id);
    if v_target is not null then
      v_alerts := v_alerts || pg_catalog.jsonb_build_array(v_target || pg_catalog.jsonb_build_object('kind', 'sheet'));
    end if;
  end loop;

  -- Nothing uses them now; release_connection keeps the token when another person's connection
  -- holds the same Google account (spec §9, M7 final review).
  return pg_catalog.jsonb_build_object(
    'released', coalesce((
      select pg_catalog.jsonb_agg(x.released)
      from (select private.release_connection(c, v_user) as released from pg_catalog.unnest(v_connections) as c) x
      where x.released is not null), '[]'::jsonb),
    'alerts', v_alerts
  );
end;
$$;

create function public.delete_account(p_confirm text)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.delete_account(p_confirm) $$;

revoke execute on function private.owner_alert_target(uuid), private.sheet_alert_target(uuid)
  from public, anon, authenticated;
grant execute on function private.delete_account(text) to authenticated;
revoke execute on function private.delete_account(text) from public, anon;
revoke execute on function public.delete_account(text) from public, anon;
grant execute on function public.delete_account(text) to authenticated;
