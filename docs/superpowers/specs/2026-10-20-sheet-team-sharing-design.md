# Sharing the Google Sheet with the team (design, 2026-10-20)

Status: for the Owner's approval (brainstorm done 2026-10-20). Builds on spec §7.17 (Google Sheet, M7) and §8 (the Sheet
worker). Mockups approved in the brainstorm (visual companion, 2026-10-20): `sheet-sharing.html`
(option A), `sheet-sharing-v2.html` (superseded by the Owner's "count only" call) and
`sheet-sharing-v3.html` (the People tag).

## 1. Why

Today, after connecting the Google Sheet, the Owner opens it in Google Drive and types each Admin's
and Viewer's email to share it. It takes time and someone always gets forgotten (Owner, 2026-10-20).
TapNShow already knows exactly who is on the team, so it shares the sheet itself and keeps access in
step with the team.

**Success:** the Owner connects the sheet once and never opens Drive's Share box for the team again;
a person who leaves the team can no longer open the sheet a minute later.

## 2. Goals, non-goals, anti-goals

Goals:
- When a sheet exists, every team member (Owner, Admins, Viewers) can view it, except the Google
  account that holds the sheet (it owns the file already).
- Access follows the team: joining gives access, leaving / removal / account deletion takes it away,
  within about a minute.
- Turning the sheet off, replacing it ("Create a new sheet" or another Google account) and deleting
  the workspace take away the access TapNShow gave, before TapNShow lets go of its Google access.
- The Owner sees at a glance whether everyone can open it, and who can't (in People).
- Each team member sees their own situation in Settings → Google Sheets.

Non-goals:
- Sharing with invited people (contacts). The sheet holds everyone's answers, reasons and comments,
  and TapNShow promises invited people never see each other's answers (privacy policy §7). **Owner:
  team only.**
- Choosing per person who gets access (Owner chose automatic, team only).
- Editing rights. Members get view access; TapNShow overwrites edits anyway.
- Touching access the Owner gave by hand in Drive.

Anti-goals (a failure even if it "works"):
- A person who left the team keeps access because a Google call failed, a run timed out, or
  TapNShow released its Google access first.
- One person Google refuses (for example an address that isn't a Google account) pauses or breaks
  the whole sheet.
- Duplicate shares, or a share email from Google sent twice for the same person.
- The Settings section growing with the team: no list of people in Google Sheets.
- A new Google permission (scope). None is needed (§4).

## 3. What people see (approved mockups)

Example: Robotics Club; the Owner connects the sheet with the club's Google account; team Sara
(Owner), Ali (Admin), Nour and Youssef (Viewers).

**Owner, "Create a Google Sheet for {workspace}?" dialog:** the body adds "Your team ({count}
people) can view it: Google emails each of them a link." (count = team members who will be shared
with). "Turn off the Google Sheet?" adds "and your team loses access to it". "Create a new Google
Sheet?" replaces "People you shared it with keep the old one." with "Your team moves to the new one
and loses access to the old one."

**Owner, Settings → Google Sheets (sheet on), option A:** under the file name and the update line,
one block:
- a tag **Shared** (green when everyone can open it, yellow when anyone can't, "Sharing…" in the
  info colour while shares are in progress) and "Your team can view it · {shared} of {total} people",
  where {total} is the people TapNShow shares with (the desired set, §5) and both numbers come from
  the sheet status API, not from the paged members list (my call);
- when the desired set is empty (the Owner alone, holding the sheet in their own account): "Only you
  so far. People who join the team get access." (my call; not in the mockups);
- only when some can't: one sentence with the count, never a list: "Google couldn't share it with
  {count, plural, one {1 person} other {# people}}, usually because the address isn't a Google
  account. You can share it with them by hand from Google Sheets. They're marked in People." ("They're
  marked in People." links to the People section);
- "People who join or leave the team get or lose access within a minute."

**Owner, Settings → People:** a small yellow tag **Can't open the sheet** under the address of each
team member Google couldn't share with (under "Can check in" when both show). Owner only: Admins and
Viewers see People without the tag (only the Owner can share by hand).

**Each team member (Admin, Viewer), Settings → Google Sheets, sheet on:** one line about their own
address, replacing today's "If Google says you need access, ask {owner}…":
- shared: "You can view it with {email}."
- couldn't share: "Google couldn't share it with {email}. Ask {owner}, the Owner, to share it with
  your Google address."
- in progress: "Sharing it with you…"
- the sheet is in their own Google account (for example the club's account is an Admin): "It's in
  your Google Drive." (my call)

**Google's own email** goes to each person shared with (Google sends it from the sheet's account;
TapNShow doesn't write it). Owner: keep it on.

All new words go through next-intl (`messages/en.json`); screens checked at 390 light, 320 dark and
1024, labelled with who sees them, before merge.

## 4. Facts (checked 2026-10-20)

- `drive.file`, which TapNShow already holds, is accepted by Drive `permissions.create`,
  `permissions.delete` (reference updated 2026-09-14) and `permissions.list` (updated 2026-07-07).
  No new scope, so nothing changes in the Google verification's scopes.
- Drive Help ("Share files from Google Drive"): "You can share a single file with up to 600
  individual email addresses." Hand shares count too.
- Drive "Resolve errors" guide (updated 2026-09-03): `sharingRateLimitExceeded` (403) "occurs when a
  user reaches a sharing limit … often linked with an email limit" (no number given);
  `invalidSharingRequest` (400) covers "the items were successfully shared but emails could not be
  sent" and "ACL change not allowed" (a Workspace domain's sharing settings).
- `sendNotificationEmail` defaults to true for users (permissions.create reference).
- Drive usage limits (updated 2026-09-11): 325,000 quota units per minute per user per project.
- Who already sees the sheet's content in TapNShow: Admins and Viewers see answers, reasons and
  comments (spec §2 roles, §4 Privacy "Admins + Viewers of the workspace see reasons"), and Viewers
  already get the Sheet link (§7.7). Sharing exposes nothing new to the team.
- Today's code: `classifyGoogleResponse` maps any non-rate-limit 403 to `access_lost`, which pauses
  the whole sheet; `turn_off_sheet` and `start_sheet(replace)` delete `sheet_syncs` and release the
  connection in the same request, and the route revokes it right after (`revokeReleased`);
  `private.connection_in_use` decides whether a connection can be released.

**Not documented, so a spike on preview answers them before the plan is final** (Owner's test
Google account as the sheet's account; the Owner's Outlook test inbox as a non-Google address):
1. What `permissions.create` does for an address with no Google account (error, or a share that
   only works once that address gets a Google account).
2. What `permissions.create` does for an address that already has a permission (a second
   permission, the existing one, or an error).
3. That revoking TapNShow's Google access leaves the file's permissions in place (expected; it
   decides whether removal must come before revocation, which this design assumes either way).
4. The exact text and sender of Google's share email.

**Spike results (2026-10-20, Owner-approved, on the platform owner's production test sheet, removed
afterwards; script `.superpowers/scripts/spike-sheet-share.ts`):**

| Call | Google's answer |
|---|---|
| `permissions.list` with `drive.file` | works (the file listed only its owner) |
| `permissions.create` (reader) for the Owner's non-Gmail test address | 200, a `user` permission, listed afterwards |
| `permissions.create` again for the same address | 200 with **the same permission id** (no duplicate), but **Google emailed the person a second time** (the Owner received 2 emails) |
| `permissions.delete` | 204 |
| `permissions.delete` of an already removed permission | 404 `notFound` |

So: TapNShow never calls `permissions.create` for an address `permissions.list` already shows; it
writes its intent before calling Google, so a crash between Google and the database is recovered by
adopting the listed permission, not by sharing again; a 404 on delete means already removed. Whether a
person without a Google account can open a shared file wasn't tested (the share was removed at once);
the wording never promises it.

## 5. How it works (decided parts)

**Desired state, one rule in one place:** a SQL function gives, for a workspace with a sheet, the
team members to share with: everyone in `workspace_roles` for that workspace, by their account
email, minus the sheet's Google account (`sheet_syncs.google_email`, compared case-insensitively),
capped at `SHEET_TEAM_SHARES_MAX` (§6). Nothing else decides who gets access.

**Actual state:** a table of the shares TapNShow made, one row per (sheet file, person): the Drive
permission id, the state (to add, shared, couldn't share, to remove), the reason Google gave,
attempts and next try. RLS: the Owner reads the workspace's rows; each member reads their own row;
no direct writes for `authenticated`. Only rows TapNShow created are ever removed, so hand shares
are never touched.

**Change detection:** statement-level triggers on `workspace_roles` (insert, update, delete) and on
`sheet_syncs` (a new file, a replaced file, turned off), like `private.sheet_memberships_changed`,
mark the workspace's shares as due. Every path that changes the team (create workspace, accept
invite, role change, remove, leave, transfer, account deletion, workspace deletion) goes through
these tables, so no route has to remember to call anything.

**Speed:** pg_cron calls `private.kick_dispatcher()` every minute (`tn-dispatch`), which starts a run
when work is due; share work must count as due there and in the worker's claim, which is what makes
"within about a minute" true. Routes that change the team may also call `scheduleWorkers(["sheets"])`
after commit to start sooner, but correctness never depends on it.

**Paused sheets:** while a sheet is paused (trashed, deleted, access lost, full), its shares wait;
they are reconciled when it resumes (my call). Removal on turn-off still applies (§5 below).

**Account emails:** TapNShow has no way to change an account's email today (no email-change path in
the code, checked 2026-10-20); if one is added later, it must mark shares due.

**The work happens in the existing Sheet worker** (same lane, lease, time budget and retry rules as
the redraws, spec §8): for a due workspace it lists the file's permissions once
(`permissions.list`), adopts an existing permission for the same address instead of creating a
second one, creates the missing ones (`permissions.create`, role `reader`, notification on), deletes
the ones whose person left (`permissions.delete`), and records each outcome. Calls stop when the
run's budget is spent; the rest waits for the next run. Sharing errors are classified per person
and never pause the sheet:
- refused for that person (`invalidSharingRequest`, "ACL change not allowed", an address Google
  rejects): the row becomes "couldn't share" with the reason. When to try again is decided after
  the spike (§4), within these bounds: at most once a day per person, and never a second Google
  email to the same person for the same file;
- rate limits (`sharingRateLimitExceeded`, `rateLimitExceeded`, `userRateLimitExceeded`) and 5xx:
  retried with the worker's backoff;
- the file gone or TapNShow's access lost: handled by the existing sheet pause rules.

**Removal before release:** turning off, replacing and deleting the workspace mark the old file's
shares "to remove" instead of forgetting them, and the Google connection stays held
(`private.connection_in_use` counts pending removals) until the worker has removed them; the worker
then releases and revokes the connection as today. The UI does not wait: the section shows the sheet
as off at once; removal happens in the background within about a minute. If TapNShow's access is
already lost (the account removed TapNShow, or Google refuses), removal is impossible: the rows are
dropped, the connection is released, and the Owner gets the existing "sheet" alert email naming how
many people may still have access, with "remove them in Google Drive".

**Account deletion of the person whose Google account holds the sheet:** today
`google_connections` rows are deleted with the account (cascade). The plan must keep the share
removals possible (for example, removing that workspace's shares before the connection is deleted,
or holding only what removal needs until it is done, never longer than a bound), and must not keep a
deleted person's token beyond the removals. **The exact mechanism is left to the plan** (§8).

**Existing sheets:** shared automatically at switch-on, with the safeguard in §7.

**Off until Google approves (Owner, 2026-10-20):** a server flag (default off, like
`NEXT_PUBLIC_GMAIL_CONNECT_ENABLED`) hides the new words and stops the worker from sharing. The
privacy policy update (section 4: TapNShow also shares the sheet with the workspace's team, view
only; section 5 "People in your groups"; the "Last updated" date) ships in the same release that
turns the flag on, after Google approves the verification.

## 6. Limits and settings (my calls, in `src/config/sheets.ts` and `private.app_limits`)

- `SHEET_TEAM_SHARES_MAX` = 500 per file (Google: 600 addresses including hand shares). People past
  it show as "couldn't share" with the reason "too many people".
- Shares per run per sheet: bounded (a config value), so one big team can't use a whole run; the
  rest continues next run.
- The new rows are per (file, person); with the 50-seats-per-user cap and today's team sizes the
  table stays small. Reads are by workspace (indexed); the People tag reads the Owner's view once per
  page.
- Logs carry counts and ids only, never addresses (repo rule).

## 7. Existing sheets (Owner, 2026-10-20)

Google's User Data Policy says an app that changes how it uses Google data must notify users and
prompt them to consent to the updated privacy policy. Production on 2026-10-20 (read-only count,
`.superpowers/scripts/prod-sheet-teams.ts`): 3 sheets; two have only their Owner on the team (nobody
else would get access); one is in the platform owner's own workspace (2 Admins would). **Owner:
existing sheets are shared automatically when the feature is switched on, with no one-time prompt.**

**Safeguard (release step):** right before switching the flag on, run the same count again. If any
sheet that isn't the platform owner's has other people on its team, stop and bring the one-time
"Share the Google Sheet with your team ({count} people)?" prompt back to the Owner before shipping.

## 8. Left to the builder (the plan decides, with tests)

- Table and function names, the exact state machine, the claim/release shape inside the Sheet
  worker, and how the share step and the redraw share one run.
- The account-deletion mechanism (§5), within the rules stated there.
- Backoff values and the per-run share cap.
- The fake Google in e2e gains `permissions.list/create/delete`.
- Tests, each watched failing first: every team-change path marks shares due (DB); the desired set
  excludes the sheet's account and stops at the cap (DB); a pending removal holds the connection
  (DB); RLS (Owner all rows, member own row, nobody writes); the worker adopts an existing
  permission, creates, deletes, records "couldn't share" without pausing, retries rate limits, stops
  at the budget, never creates twice after a crash between Google and the database (unit, fake
  Google); the Settings and People views (unit, screenshots); one e2e story (connect, a Viewer sees
  "You can view it", remove the Viewer, the permission is gone).
- Zero warnings, `bun run test:db`, advisors clean, after every migration (repo rules).
