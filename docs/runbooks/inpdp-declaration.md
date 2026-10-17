# INPDP declaration and transfer authorisation (Tunisia)

TapNShow's operator files two forms with Tunisia's data protection authority, the INPDP (Instance
Nationale de Protection des Données à caractère Personnel, inpdp.nat.tn), as Organic Law
No. 2004-63 requires:

- the **prior declaration** of the processing (law art. 7; decree No. 2007-3004 arts. 3, 4, 8, 9):
  no objection within one month counts as accepted;
- the **authorisation to transfer data abroad** (law arts. 51, 52; decree art. 11): the data is
  stored in Germany and with Google. The INPDP decides within one month.

The forms are signed by the operator personally and handed in against a receipt, or sent by
registered mail with acknowledgement (decree arts. 3, 4). Keep the receipts; the Privacy Policy
names the declaration only once there is one.

Sources: the law and the decree as published on legislation-securite.tn (read 2026-10-15).

## Answers for the declaration form (decree art. 8)

| The form asks | Answer |
|---|---|
| Controller (name, address) | Mohamed Ali Chouikh, individual; address: the operator's own (not written here: this repository is public). Processor: none in Tunisia; hosting services below. |
| Whose data | (1) People with a TapNShow account (organizers, team members, people who sign in to see their invites); (2) people a group adds to its workspace and invites to meetings. |
| Purpose | Let groups that meet regularly invite people to meetings from the organizer's own Gmail, collect answers, check people in, send reminders and keep a Google Sheet up to date. No advertising, no profiling, no sale. |
| Categories and place of processing | Online service at https://www.tapnshow.tn; processing on the hosting services below. |
| Data processed and origin | Account: email, display name, Google profile picture address (Google sign-in only), last workspace. Contacts: name, email, the group's lists, unsubscribe status (entered or imported by the group's organizers). Meetings, answers (status, optional reason and comment, given by the person), check-ins (by organizers). Google connections: Google account email, granted permissions, encrypted refresh token. Notification subscriptions (browser endpoint). Abuse counters per IP address (2 days). Error reports without personal links, secrets or IP addresses. The platform team's admin log: actions such as pausing a group's sending, with the workspace's name and the team members' partly hidden addresses (never the group's members). |
| Who can see the data | Each workspace's team (its organizers); the person themself for their own answers; the operator for maintenance and abuse handling. Platform administrators see per-workspace counts, never contacts, answers, reasons or comments. |
| Recipients | No one else. Service providers (below) process data only for TapNShow. |
| Where stored, and for how long | Supabase (database, AWS eu-central-1, Frankfurt, Germany); Vercel (hosting functions in Frankfurt, Germany); Sentry (error reports, EU); Google (Gmail sending, the group's Sheet in the organizer's Drive). Retention: until the account or workspace is deleted; sent-email records 30 days; abuse counters 2 days; idle notification devices 90 days; empty draft meetings 24 hours; the admin log while the service runs (it keeps a deleted workspace's name). Account deletion erases the person's reasons and comments everywhere. |
| Security measures | HTTPS everywhere; row-level security on every table; Google refresh tokens encrypted (AES-GCM); personal links stored only as SHA-256 hashes; rate limits on every write and sign-in step; secrets only in the hosting provider's encrypted settings; nightly backups encrypted with age and restored before they are kept; logs and error reports scrubbed of personal links and secrets. |
| Interconnected databases | None. |
| Commitment and statement | Signed by the operator (nationality, residence in Tunisia, no criminal record), as the form requires. |

## Extra answers for the transfer authorisation (decree art. 11)

| The form asks | Answer |
|---|---|
| Data transferred | All of the above (the whole database is hosted abroad). |
| Countries | Germany (Supabase, Vercel functions, Sentry EU region); United States and other countries where Google processes Gmail and Drive data. |
| Safeguards | EU hosting under the GDPR; each provider's data processing terms; encryption in transit and at rest; minimal data (no special categories). |
