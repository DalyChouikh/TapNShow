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
   > TapNShow sends meeting invitations, updates, cancellations and reminders from the group's own
   > Gmail address, so members receive them from a sender they know and replies reach the group.
   > `gmail.send` is the narrowest Gmail scope that sends: TapNShow never reads, lists, modifies or
   > deletes mail, so `gmail.readonly`, `gmail.compose` and `gmail.modify` would grant more than it
   > uses.
3. Demo video: upload it to YouTube Studio with Visibility **Unlisted**, then paste its link in the
   **YouTube link** field (script below).
4. Submit; answer Google's questions from the Owner's inbox. Google says sensitive-scope review
   "typically takes 3-5 business days".

## Demo video script (English; one take is fine)

What Google asks the video to show, from two pages read on 2026-10-17:
[Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
(step 13, last updated 2026-08-19) and Google Cloud's
[Demo Video](https://support.google.com/cloud/answer/13804565) help.

| Google asks the video to show | Shown in step |
|---|---|
| The end-to-end flow, including how a user initiates and grants access, and **each** OAuth consent workflow: Sign in with Google, Connect Gmail, Connect Google Sheets | 2, 4, 8 |
| The consent screen shows the App Name (TapNShow) and the same exact scopes that were submitted | 2, 4, 8 |
| The consent screen's language setting (bottom left) is set to English | 2, 4, 8 |
| The browser address bar of the consent screen includes the app's OAuth client ID (`client_id=` in the URL) | 2, 4, 8 |
| How each requested scope is used: `gmail.send` sends the group's meeting emails; `drive.file` keeps the answers in a Google Sheet | 5 to 7, 9 |

**Narration is optional.** Google says "Voice or text narration highlighting the points above can
greatly help facilitate our review" and suggests "screen recording and/or video editing software to
explicitly call out where the above criteria are met". So: record silently, then add a short text
callout at each row of the table while editing (for example "App name: TapNShow", "OAuth client ID in
the address bar", "Permission: Send email on your behalf"). Editing only trims waiting time and adds
callouts; it never cuts inside a consent screen.

While recording:
- record the whole browser window, so the address bar is always in the picture;
- stay about 3 seconds on each consent screen's app name, on its address bar and on each permission;
- before continuing past a consent screen, check its language selector (bottom left) says English;
- use a test workspace and test addresses only.

1. Open https://www.tapnshow.tn, show the landing and the privacy page's Google section (10 s).
2. **Sign in with Google:** in a signed-out window, Sign in → **Continue with Google**. On Google's
   screen, show the app name, the language (English) and the address bar (`client_id=` in the URL),
   then pick the test Google account and continue.
3. Back in TapNShow, signed in: open a test workspace → Settings → Sending → **Connect Gmail**.
4. **Connect Gmail:** on Google's consent screen, show the app name, the language (English), the
   address bar (`client_id=` in the URL) and the permission "Send email on your behalf". Continue.
5. Back in TapNShow: "Sending from <test address>".
6. Create a meeting to the Owner's own test addresses only → Review → Send → the progress reaches
   sent.
7. Open the test inbox: the invite comes from the group's address; tap "I'm going"; show the answer
   in TapNShow.
8. **Connect Google Sheets:** Settings → Google Sheets → **Connect Google Sheets** → "Create a Google
   Sheet for <workspace>?" → **Continue to Google**. On Google's consent screen, show the app name,
   the language (English), the address bar (`client_id=` in the URL) and the Google Drive permission
   (only the files TapNShow creates). Continue.
9. Back in TapNShow: the sheet is created; open it and show the answer from step 7 in its row.

Never use the club's workspace or members' addresses in the video.
