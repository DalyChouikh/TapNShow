# Restore runbook (spec §5 backups)

Backups: GitHub → Actions → Backup → a run → Artifacts → `tapnshow-backup-<run id>` (30 days).
Each one was restored into a throwaway stack and checked table by table before it was kept
(`scripts/backup-counts.sql`, compared by `scripts/compare-counts.ts`).

## Decrypt

    unzip tapnshow-backup-<run id>.zip
    age -d -i ~/.config/tapnshow/backup-age.key backup.tar.gz.age | tar -xzf -

(the key's copy is in `.env.local`, OTHER SECRETS). This gives `roles.sql`, `schema.sql`,
`data.sql`, `history_schema.sql`, `history_data.sql`, `auth-triggers.sql` and `counts.txt`.

## Restore into a new Supabase project

Steps from Supabase's "Backup and restore using the CLI" guide, plus our two extras.

1. Create the project (Free), copy its **Session pooler** connection string.
2. Roles, schema and data in one transaction:

       psql --single-transaction -v ON_ERROR_STOP=1 \
         -f roles.sql -f schema.sql -c 'SET session_replication_role = replica' -f data.sql \
         --dbname "<connection string>"

   If `roles.sql` stops on `GRANT SET ON PARAMETER "log_min_messages" TO "supabase_realtime_admin"`,
   delete that line and run again: it is Supabase's own grant, which a hosted project's `postgres`
   role may not run (a new project's platform roles are set up by Supabase).
3. The migration history and our triggers on Supabase's auth tables (new user → profile, Google
   identity), which the schema dump leaves out:

       psql --single-transaction -v ON_ERROR_STOP=1 \
         -f history_schema.sql -f history_data.sql -f auth-triggers.sql \
         --dbname "<connection string>"

4. Put the dispatcher secrets back into Vault (they are not in the backup): `tn_dispatch_url`,
   `tn_dispatch_secret` (values in `.env.local`).
5. Point Vercel's Supabase env vars at the new project (ask before any env write), redeploy, and
   run the auth config script (`bun run auth:config`) for the new project.
6. Run `scripts/backup-counts.sql` on the new project and compare with `counts.txt`:
   `bun scripts/compare-counts.ts counts.txt <new counts file>` must say "Restore check passed."

## Monthly drill

Download the latest artifact and decrypt it once a month (proves the key still works).
