-- M7 final review: Google's revoke removes the whole grant of a Google account for our client, so a
-- released connection is revoked only when no other person's connection to the same account
-- remains (e.g. two Owners over time on the club's shared Google account).
-- Latest body: release_connection from 20261011091257_m7_sheet_state.sql.

-- The only place a Google connection is deleted: when nothing uses it any more, and only by its own
-- user's action (security review: a new Owner's Turn off, Create a new sheet or workspace deletion
-- must never revoke someone else's Google account; an unused one stays in that person's Sending
-- settings for them to disconnect). Returns what the route needs to revoke the token at Google:
-- null when kept, already gone, or when another person's connection shares the Google grant.
create or replace function private.release_connection(p_connection uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_released jsonb;
begin
  if p_connection is null or private.connection_in_use(p_connection) then
    return null;
  end if;
  delete from public.google_connections c
  where c.id = p_connection and c.user_id = p_actor
  returning pg_catalog.jsonb_build_object(
    'refresh_token_encrypted', c.refresh_token_encrypted, 'google_sub', c.google_sub, 'user_id', c.user_id)
  into v_released;
  -- Any row left on this Google account is another person's (one per user and account).
  if exists (select 1 from public.google_connections o where o.google_sub = v_released ->> 'google_sub') then
    return null;
  end if;
  return v_released;
end;
$$;
