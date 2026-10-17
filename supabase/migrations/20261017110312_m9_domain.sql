-- TapNShow moved to www.tapnshow.tn (Owner, 2026-10-17). New meetings' calendar UIDs name the new
-- host (twin of PRODUCTION_URL in src/config/site.ts, pinned by m9-domain.db.test.ts). Existing
-- meetings keep theirs: a calendar matches an update or a cancellation to its event by UID, so a
-- changed UID would leave the old event behind and add a second one.
alter table public.meetings
  alter column ics_uid set default (gen_random_uuid()::text || '@www.tapnshow.tn');
