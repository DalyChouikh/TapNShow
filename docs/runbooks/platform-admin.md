# Platform admin runbook (spec §7.19)

## Set the platform owner (once per project; asked first on production)

1. Sign in to TapNShow once with the address (the account must exist and be verified).
2. `bun scripts/set-platform-owner.ts --email <address> --project local|preview|production`
3. It prints the address masked. Running it again changes nothing. Another owner already set:
   add `--replace` (the old owner becomes an admin). Every change is in the Log tab and `#platform`.

The address is never written in the repo, a migration or an issue.

## Add an admin

Admin area → Admins → Add an admin (platform owner only). The invite is email-bound, lasts 7 days,
and needs the invited, verified address to accept.
