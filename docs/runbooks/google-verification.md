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

Google's page (step 13) asks the video to show, in English:

| Google asks the video to show | Shown in step |
|---|---|
| How a user initiates and grants access: the consent flow and, because TapNShow uses Google Sign-In, the sign-in flow | 2 and 3 |
| The consent screen displays the App Name (TapNShow) | 2 and 4 |
| The consent screen's browser address bar includes the app's OAuth client ID (`client_id=` in the URL) | 2 and 4 |
| The feature enabled by each sensitive scope: `gmail.send` sends the group's meeting emails | 5 to 7 |

Record the whole browser window so the address bar is always in the picture.

1. Open https://www.tapnshow.tn, show the landing and the privacy page's Google section (10 s).
2. **Sign in with Google:** in a signed-out window, Sign in → **Continue with Google**. On Google's
   screen, show the app name, then the address bar (`client_id=` in the URL), then pick the test
   Google account and continue.
3. Back in TapNShow, signed in: open a test workspace → Settings → Sending → **Connect Gmail**.
4. Google's consent screen: show the app name, then the address bar (`client_id=` in the URL), then
   the permission "Send email on your behalf". Continue.
5. Back in TapNShow: "Sending from <test address>".
6. Create a meeting to the Owner's own test addresses only → Review → Send → the progress reaches
   sent.
7. Open the test inbox: the invite comes from the group's address; tap "I'm going"; show the answer
   in TapNShow.
8. (Sheets uses `drive.file`, non-sensitive: not needed in the video.)

Never use the club's workspace or members' addresses in the video.
