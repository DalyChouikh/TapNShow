-- Security review fix (M4 Task 2): the Google account id and email of a connection must come from
-- Google's verified ID token, which only the server-side OAuth callback sees. Signed-in users could
-- call save_google_connection directly with any google_sub/email, e.g. another account's sub, whose
-- quota and sending lease are keyed by it. Only the service role (the callback) may save now, and it
-- names the verified user explicitly.

drop function public.save_google_connection(text, text, text[], text);
drop function private.save_google_connection(text, text, text[], text);

create function private.save_google_connection(
  p_user uuid,
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
  v_id uuid;
begin
  if p_user is null or not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  if not ('https://www.googleapis.com/auth/gmail.send' = any (coalesce(p_scopes, '{}'))) then
    raise exception 'tn:invalid_input' using errcode = 'P0001';
  end if;
  insert into public.google_connections (user_id, google_sub, google_email, granted_scopes, refresh_token_encrypted)
  values (p_user, p_google_sub, lower(btrim(p_google_email)), p_scopes, p_token_encrypted)
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

create function public.save_google_connection(
  p_user uuid,
  p_google_sub text,
  p_google_email text,
  p_scopes text[],
  p_token_encrypted text
)
returns uuid language sql security invoker set search_path = ''
as $$ select private.save_google_connection(p_user, p_google_sub, p_google_email, p_scopes, p_token_encrypted) $$;

revoke execute on function private.save_google_connection(uuid, text, text, text[], text) from public, anon, authenticated;
revoke execute on function public.save_google_connection(uuid, text, text, text[], text) from public, anon, authenticated;
grant execute on function private.save_google_connection(uuid, text, text, text[], text) to service_role;
grant execute on function public.save_google_connection(uuid, text, text, text[], text) to service_role;
