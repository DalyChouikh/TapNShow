select 'auth.users|' || count(*) from auth.users
union all select 'public.workspaces|' || count(*) from public.workspaces
union all select 'public.workspace_roles|' || count(*) from public.workspace_roles
union all select 'public.contacts|' || count(*) from public.contacts
union all select 'public.lists|' || count(*) from public.lists
union all select 'public.meetings|' || count(*) from public.meetings
union all select 'public.meeting_invitees|' || count(*) from public.meeting_invitees
union all select 'public.responses|' || count(*) from public.responses
union all select 'public.response_history|' || count(*) from public.response_history
union all select 'public.attendance_marks|' || count(*) from public.attendance_marks
union all select 'public.google_connections|' || count(*) from public.google_connections
union all select 'public.outbox_jobs|' || count(*) from public.outbox_jobs
-- Our triggers on Supabase's auth tables (schema.sql leaves the auth schema out; restored from
-- auth-triggers.sql) and the migration history (restored from history_*.sql).
union all select 'auth.triggers (ours)|' || count(*) from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_proc p on p.oid = t.tgfoid
  where not t.tgisinternal and c.relnamespace = 'auth'::regnamespace
    and p.pronamespace <> 'auth'::regnamespace
union all select 'supabase_migrations.schema_migrations|' || count(*) from supabase_migrations.schema_migrations
order by 1;
