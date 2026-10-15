-- M9 (spec §4 Tenancy): a person holds at most 50 seats (any role), so /api/me always lists them
-- all (the Data API returns at most 1,000 rows) and the workspace switcher stays usable.
insert into private.app_limits (name, value) values ('workspace_seats_per_user_max', 50);

-- Every path that adds a seat (create_workspace, accept_invite, the service role) goes through this
-- trigger. The advisory lock per person makes two simultaneous accepts take turns, and the count
-- after the lock sees the other one's committed seat (read committed: a new snapshot per statement).
create function private.enforce_seat_cap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seats integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('seats:' || new.user_id::text));
  select count(*) into v_seats from public.workspace_roles r where r.user_id = new.user_id;
  if v_seats >= private.app_limit('workspace_seats_per_user_max') then
    raise exception 'tn:workspace_seats_limit_reached' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke execute on function private.enforce_seat_cap() from public, anon, authenticated;

create trigger workspace_roles_seat_cap
  before insert on public.workspace_roles
  for each row execute function private.enforce_seat_cap();
