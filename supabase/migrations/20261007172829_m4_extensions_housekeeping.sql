-- M4 (spec §8 Housekeeping): declare the extensions S1 enabled by hand, move pg_net out of public
-- (advisor lint 0014; Supabase troubleshooting guide: drop + create with an empty request queue),
-- and trim rate-limit events that hit_rate_limit never revisits.

create extension if not exists pg_cron;

do $$
begin
  if exists (
    select 1 from pg_catalog.pg_extension e
    join pg_catalog.pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'pg_net' and n.nspname <> 'extensions'
  ) then
    drop extension pg_net;
  end if;
end;
$$;
create extension if not exists pg_net with schema extensions;

create function private.housekeeping()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from private.rate_limit_events e where e.occurred_at < pg_catalog.now() - interval '2 days';
end;
$$;
revoke execute on function private.housekeeping() from public, anon, authenticated, service_role;

select cron.schedule('tn-housekeeping', '17 3 * * *', $$select private.housekeeping()$$);
