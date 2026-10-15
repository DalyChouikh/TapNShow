-- M9 (spec §5 Operations): the keep-alive workflow's signed-out read. A real query through the Data
-- API that reveals nothing (the database's clock). anon has no table grants, so no table is used.
create function public.keep_alive()
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$ select pg_catalog.now() $$;
revoke execute on function public.keep_alive() from public;
grant execute on function public.keep_alive() to anon, authenticated;
