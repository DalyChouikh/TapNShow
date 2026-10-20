# Google verification runbook (spec §9 M9)

Order (Owner, 2026-10-15): M9 engineering → the new logo, uploaded in Google Cloud → this →
the promo video. Branding can't change while verification is in progress.

Written from Google's pages read on 2026-10-15 (Google Auth Platform help: brand verification,
sensitive scope verification, the API Services User Data Policy); the demo video part re-read on
2026-10-17 against [Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
(step 13, last updated 2026-08-19). Re-check each link the day it is used: Google changes these
screens without notice.

## Scopes TapNShow asks for

| Scope | Where | Class |
|---|---|---|
| `openid`, `email`, `profile` | Sign in with Google (`GOOGLE_SCOPES`, `src/config/auth.ts`) | non-sensitive |
| `openid`, `email`, `https://www.googleapis.com/auth/gmail.send` | Settings → Sending → Connect Gmail (`GMAIL_CONNECT_SCOPES`, `src/config/gmail.ts`) | **sensitive** |
| `openid`, `email`, `https://www.googleapis.com/auth/drive.file` | Settings → Google Sheets (`SHEETS_CONNECT_SCOPES`, `src/config/sheets.ts`) | non-sensitive |

Nothing else. If the code ever asks for another scope, this table and the Data access screen change
in the same PR.

## Before submitting (I check, you confirm)

- [ ] https://www.tapnshow.tn/ is the landing (not a sign-in page) and links /privacy and /terms.
- [ ] /privacy has the Limited Use sentence and says what Gmail and Drive access are for
      (pinned by `src/content/legal/content.test.ts`).
- [ ] Search Console shows the Domain property `tapnshow.tn` verified (DNS record at the
      registrar; it covers `www` and the apex).
- [ ] Google Auth Platform → Branding: app name TapNShow, the new logo (download
      https://www.tapnshow.tn/icons/logo-120.png and upload it; uploading a logo starts verification, so
      do it here, as part of the submission), support email = the platform
      address, home page, privacy and terms links = the three pages above, authorized domain
      `tapnshow.tn`.
- [ ] Data access: exactly the scopes in the table above.

## Steps

1. Branding → **Verify branding** → when it passes, **Publish branding** (automated, minutes).
2. Verification Center → Data access → **Add or remove scopes** (as above) → justification:
   > TapNShow sends meeting invitations, calendar confirmations, updates, cancellations and
   > reminders from the group's own Gmail address, so members receive them from a sender they know
   > and replies reach the group. `gmail.send` is the narrowest Gmail scope that sends: TapNShow
   > never reads, lists, modifies or deletes mail, so `gmail.readonly`, `gmail.compose` and
   > `gmail.modify` would grant more than it uses.
3. Demo video: upload it to YouTube Studio with Visibility **Unlisted**, then paste its link in the
   **YouTube link** field (script below).
4. Submit; answer Google's questions from the Owner's inbox. Google says sensitive-scope review
   "typically takes 3-5 business days".

## Review history

### Round 1: submitted 2026-10-18, answered by Google 2026-10-20

Google's email (to the Owner) asked for:

| # | Google asked | What changed | Who |
|---|---|---|---|
| 1 | The privacy policy must state "with whom you share, transfer, or disclose Google user data", then an update and resubmission with the policy link | `/privacy` section 5 "Who we share Google data with"; the AI/ML sentence for Google Workspace APIs; how long Google connections are kept (#406) | code: me; resubmission: the Owner |
| 2 | A new video showing why the scope is necessary or why narrower permissions can't be used: "the maximum extent of the user facing features using the scope(s)" | the round 2 script below: all five emails TapNShow sends through Gmail, and callouts on why `gmail.send` is the narrowest | script and edit: me; recording: the Owner |
| 3 | Every consent screen "with all requested scopes fully expanded and readable—if the scopes are obscured, click 'Show all services'" | record from a test account whose TapNShow access was removed; open every folded list | the Owner |
| 4 | "The scopes requested by your app or manifest must exactly match the scopes configured and submitted" | the code asks for exactly the table above (checked 2026-10-20); Data access must list exactly those | the Owner checks Data access |
| 5 | Reply to Google's email once fixed, or the review doesn't continue | the reply below | the Owner |

The email named no scope. `gmail.send` is the only sensitive one, so round 2 is about it (Owner,
2026-10-20). "Show all services" isn't described on Google's help pages (checked 2026-10-20): the
likely cause is that the test account had already granted TapNShow access, so Google folded those
permissions. Connect Gmail and Connect Google Sheets keep earlier grants
(`include_granted_scopes`) on purpose: one Google connection can serve both sending and the Sheet.

**Why `gmail.send` is the narrowest** ([Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes),
updated 2026-09-10): the only Gmail scopes that can send are `gmail.send` (sensitive, "Send email on
your behalf"), `gmail.compose` (restricted, "Manage drafts and send emails"), `gmail.modify`
(restricted, "Read, compose, and send emails from your Gmail account") and `https://mail.google.com/`
(restricted, "Read, compose, send, and permanently delete all your email from Gmail").
`gmail.addons.current.action.compose` works only inside a Google Workspace add-on, and TapNShow is a
website, not an add-on.

**The reply to Google** (the Owner sends it after resubmitting; fill in the video link):

> Hello,
>
> Thank you for reviewing project 850676857783 (tapnshow-510707). We have addressed both items and
> resubmitted the app in the Cloud Console.
>
> 1. Privacy policy: https://www.tapnshow.tn/privacy now has a section "5. Who we share Google data
>    with", which lists everyone with whom we share, transfer or disclose Google user data. It also
>    states how long Google data is kept and that data from Google Workspace APIs is never used to
>    develop, improve or train AI or ML models.
> 2. Demo video: <YouTube link>. It shows each OAuth consent workflow (Sign in with Google, Connect
>    Gmail, Connect Google Sheets) in English, with the app name, the OAuth client ID in the address
>    bar and every requested scope expanded. It shows every feature that uses gmail.send: the
>    meeting invitation, the calendar confirmation, the reminder, the update and the cancellation,
>    each sent from the group's own Gmail address. gmail.send is the narrowest Gmail scope that can
>    send: TapNShow never reads, lists, modifies or deletes mail.
>
> The scopes our app requests (openid, email, profile, gmail.send, drive.file) exactly match the
> scopes configured on the Data Access page.
>
> Best regards,
> TapNShow

## Demo video script (round 2, 2026-10-20; English)

What Google asks the video to show, from Google's round 1 email and two pages read on 2026-10-20:
[Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
(step 13, last updated 2026-08-19) and Google Cloud's
[Demo Video](https://support.google.com/cloud/answer/13804565) help.

| Google asks the video to show | Shown in step |
|---|---|
| The end-to-end flow, including how a user initiates and grants access, and **each** OAuth consent workflow: Sign in with Google, Connect Gmail, Connect Google Sheets | 2, 4, 13 |
| The consent screen shows the App Name (TapNShow) and the same exact scopes that were submitted, **every one expanded and readable** | 2, 4, 13 |
| The consent screen's language setting (bottom left) is set to English | 2, 4, 13 |
| The browser address bar of the consent screen includes the app's OAuth client ID (`client_id=` in the URL) | 2, 4, 13 |
| **Every** feature that uses `gmail.send`, and why no narrower permission can send | 6 to 12 |
| How `drive.file` is used: the answers go into the one Google Sheet TapNShow creates | 14 |

**Narration is optional.** Google says "Voice or text narration highlighting the points above can
greatly help facilitate our review". So: record silently; the edit adds a short text callout at each
row of the table. Editing only trims waiting time, adds callouts and blurs unrelated rows; it never
cuts inside a consent screen.

### Before recording (the Owner)

1. Use the Owner's test Google account (here "the group's account"), the Owner's test workspace and
   two of the Owner's own test inboxes (A and B) only. Never the club's workspace or members.
2. In TapNShow, signed in with the group's account, open the test workspace → Settings:
   **Sending → Disconnect <address>**, and **Google Sheets → Turn off the Google Sheet**. TapNShow
   deletes both connections and asks Google to remove its access.
3. With the group's account, open https://myaccount.google.com/linkedapps (Google Account Help,
   "Manage links between your Google Account & apps from other developers", read 2026-10-20):
   - **Sign in with Google** → TapNShow → **See details** → **Stop using Sign in with Google**;
   - **Access to your Google Account** → TapNShow → **See details** → **Remove access** (if listed).

   Google then shows every permission again, as a first-time user sees them.
4. In the test workspace's people, keep inboxes A and B (and no one else).
5. Sign out of TapNShow. One browser window, nothing else open; browser zoom 110 % so the permission
   text is readable; record the **whole window**, so the address bar is always in the picture.
6. Have inboxes A and B and the group's Gmail ready to open in tabs of that same window, signed in
   (Gmail's account switcher). Unrelated inbox rows are blurred in the edit.

### Recording (one take, or one per part; each part starts where the last ended)

On **every** Google screen: stay about 3 seconds on the app name, the address bar and the language
(bottom left, English). If Google folds any permission (for example "TapNShow already has some
access", "Show all services", "See all", or a collapsed item), **click it open** and stay 3 seconds on
the full list. Tick every permission checkbox Google shows. Then continue.

**Part 1: the app and its policy (about 15 s)**

1. Open https://www.tapnshow.tn: the landing. Footer → **Privacy** → scroll to "4. Google data" and
   "5. Who we share Google data with" (3 s each).

**Part 2: Sign in with Google (consent workflow 1)**

2. **Sign in → Continue with Google** → the group's account. On Google's screen: the app name, the
   address bar, the language, and each item Google will share (name, email address, profile
   picture). Continue.

**Part 3: Connect Gmail (consent workflow 2, the sensitive permission)**

3. The test workspace → Settings → **Sending → Connect Gmail** → the group's account.
4. On Google's consent screen: the app name, the address bar, the language and the permission "Send
   email on your behalf", with every folded list opened. Continue.
5. Back in TapNShow: "Sending from <workspace> <group's address>" (3 s).

**Part 4: every email TapNShow sends with `gmail.send`**

6. **Meetings → New meeting:** a title, tomorrow at a round hour, in person, answers Going / Late /
   Not going; audience: A and B → **Review → Send** → confirm → the progress reaches sent.
   *Email 1: the invitation.*
7. Inbox A: the invitation from the group's address (open it so the From line shows). Tap
   **I'm going**; the answer page confirms.
8. Inbox A: the calendar email from the group's address (it puts the meeting in A's calendar).
   *Email 2: the calendar confirmation.*
9. TapNShow, the meeting page: A's answer shows. **Remind 1 who hasn't answered** → **Send
   reminders**. Inbox B: the reminder from the group's address. *Email 3: the reminder.*
10. TapNShow: **Edit** → move the start one hour later → **Next: Review changes** → confirm. Inbox A: the
    update from the group's address. *Email 4: the update.*
11. TapNShow: **Cancel meeting** → confirm. Inbox A: the cancellation from the group's address.
    *Email 5: the cancellation.*
12. The group's Gmail → **Sent**: the emails TapNShow sent (3 s). Then TapNShow → Settings →
    Sending: the line "… emails in the last 24 hours" (3 s).

**Part 5: Connect Google Sheets (consent workflow 3)**

13. Settings → **Google Sheets → Connect Google Sheets** → "Create a Google Sheet for <workspace>?" →
    **Continue to Google** → the group's account. On Google's consent screen: the app name, the
    address bar, the language and the Google Drive permission (only the files TapNShow creates),
    with every folded list opened. Continue.
14. Back in TapNShow: the sheet is created; open it and show A's and B's rows.

### The callouts the edit adds

- Each consent screen: "Consent workflow N of 3: …", "App name: TapNShow", "OAuth client ID in the
  address bar", "Language: English", and the permission names with their scopes.
- At the Gmail permission: "`gmail.send` is the narrowest Gmail permission that can send. TapNShow
  never reads, lists, changes or deletes mail." and "Narrower scopes can't send: `gmail.readonly` and
  `gmail.metadata` only read; `gmail.compose`, `gmail.modify` and `https://mail.google.com/` also
  read or manage mail."
- Each email: "`gmail.send` in use, N of 5: <the email>, from the group's own Gmail".
- The sheet: "`drive.file` in use: the one sheet TapNShow created".

Never use the club's workspace or members' addresses in the video.
