-- Profiles must not trust client-controlled sign-up data. `raw_user_meta_data` can be set by the
-- client at email sign-up (signInWithOtp `data`), so the user trigger now creates an empty profile.
-- Name and avatar come only from a Google identity row, whose `identity_data` Supabase Auth fills
-- from Google's verified ID token; avatars must be Google-hosted.

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

create function private.handle_new_google_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(left(btrim(coalesce(new.identity_data ->> 'full_name', new.identity_data ->> 'name', '')), 80), '');
  v_avatar text := coalesce(new.identity_data ->> 'avatar_url', new.identity_data ->> 'picture', '');
begin
  update public.profiles p
  set display_name = coalesce(p.display_name, v_name),
      avatar_url = coalesce(
        p.avatar_url,
        case when v_avatar ~ '^https://[a-z0-9-]+\.googleusercontent\.com/' then v_avatar end
      )
  where p.user_id = new.user_id;
  return new;
end;
$$;

create trigger on_auth_identity_google_created
  after insert on auth.identities
  for each row
  when (new.provider = 'google')
  execute function private.handle_new_google_identity();

revoke execute on function private.handle_new_user(), private.handle_new_google_identity() from public, anon, authenticated;
