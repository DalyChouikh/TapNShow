-- Records many people's outcomes in one call (#413, final review minor): the share run's adoptions,
-- hand shares, removals in Drive and people past the cap need no Google call each, so they are one
-- set-based upsert under the lease instead of one call per person. Same rules as sheet_share_save.
create function public.sheet_share_save_many(p_workspace uuid, p_run uuid, p_rows jsonb)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not private.sheet_shares_leased(p_workspace, p_run) then
    return false;
  end if;
  insert into public.sheet_shares as sh (workspace_id, user_id, email, state, permission_id, reason, next_try_at)
  -- One row per address (ON CONFLICT can touch a row once per statement).
  select distinct on (pg_catalog.lower(r.email))
    p_workspace, r.user_id, pg_catalog.lower(r.email), r.state, r.permission_id, r.reason, r.next_try_at
  from pg_catalog.jsonb_to_recordset(p_rows) as r(
    email text, user_id uuid, state public.sheet_share_state, permission_id text,
    reason public.sheet_share_reason, next_try_at timestamptz)
  order by pg_catalog.lower(r.email)
  on conflict (workspace_id, email) do update
    set user_id = excluded.user_id, state = excluded.state, permission_id = excluded.permission_id,
      reason = excluded.reason, next_try_at = excluded.next_try_at, updated_at = pg_catalog.now();
  return true;
end;
$$;

revoke execute on function public.sheet_share_save_many(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.sheet_share_save_many(uuid, uuid, jsonb) to service_role;
