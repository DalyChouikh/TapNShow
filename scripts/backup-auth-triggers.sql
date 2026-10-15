-- Our triggers on Supabase's auth tables, as runnable DDL (backup.yml writes auth-triggers.sql
-- with it). The schema dump leaves the auth schema out, so a restore re-creates them from this.
-- Schemas are compared by namespace, not by regclass text (which depends on the search path).
select pg_catalog.pg_get_triggerdef(t.oid) || ';'
from pg_catalog.pg_trigger t
join pg_catalog.pg_class c on c.oid = t.tgrelid
join pg_catalog.pg_proc p on p.oid = t.tgfoid
where not t.tgisinternal
  and c.relnamespace = 'auth'::regnamespace
  and p.pronamespace <> 'auth'::regnamespace
order by t.tgname;
