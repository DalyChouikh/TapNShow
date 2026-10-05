-- Health probe used by GET /api/health. Callable only with the secret (service) key.
create or replace function public.healthcheck()
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$
  select now();
$$;

revoke execute on function public.healthcheck() from public, anon, authenticated;
grant execute on function public.healthcheck() to service_role;
