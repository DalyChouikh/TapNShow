# Google verification runbook (spec §9 M9)

Order (Owner, 2026-10-15): M9 engineering → the new logo, uploaded in Google Cloud → this →
the promo video. Branding can't change while verification is in progress.

Written from Google's pages read on 2026-10-15 (Google Auth Platform help: brand verification,
sensitive scope verification, the API Services User Data Policy). Re-check each link the day it is
used: Google changes these screens without notice.

## Scopes TapNShow asks for

| Scope | Where | Class |
|---|---|---|
| `openid`, `email`, `profile` | Sign in with Google (`GOOGLE_SCOPES`, `src/config/auth.ts`) | non-sensitive |
| `openid`, `email`, `https://www.googleapis.com/auth/gmail.send` | Settings → Sending → Connect Gmail (`GMAIL_CONNECT_SCOPES`, `src/config/gmail.ts`) | **sensitive** |
| `openid`, `email`, `https://www.googleapis.com/auth/drive.file` | Settings → Google Sheets (`SHEETS_CONNECT_SCOPES`, `src/config/sheets.ts`) | non-sensitive |

Nothing else. If the code ever asks for another scope, this table and the Data access screen change
in the same PR.

## Before submitting (I check, you confirm)

- [ ] https://tapnshow.vercel.app/ is the landing (not a sign-in page) and links /privacy and /terms.
- [ ] /privacy has the Limited Use sentence and says what Gmail and Drive access are for
      (pinned by `src/content/legal/content.test.ts`).
- [ ] Search Console still shows the property verified (`NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` is
      set in Vercel Production).
- [ ] Google Auth Platform → Branding: app name TapNShow, the new logo, support email = the platform
      address, home page, privacy and terms links = the three pages above, authorized domain
      `tapnshow.vercel.app`.
- [ ] Data access: exactly the scopes in the table above.

## Steps

1. Branding → **Verify branding** → when it passes, **Publish branding** (automated, minutes).
2. Verification Center → Data access → **Add or remove scopes** (as above) → justification:
   > TapNShow sends meeting invitations, updates, cancellations and reminders from the group's own
   > Gmail address, so members receive them from a sender they know and replies reach the group.
   > `gmail.send` is the narrowest Gmail scope that sends: TapNShow never reads, lists, modifies or
   > deletes mail, so `gmail.readonly`, `gmail.compose` and `gmail.modify` would grant more than it
   > uses.
3. Demo video: link the unlisted YouTube video (script below).
4. Submit; answer Google's questions from the Owner's inbox. Google says sensitive-scope review
   "typically takes 3-5 business days".

## Demo video script (English; one take is fine)

1. Open https://tapnshow.vercel.app, show the landing and the privacy page's Google section (10 s).
2. Sign in, open a test workspace → Settings → Sending → **Connect Gmail**.
3. Google's consent screen: show the app name, then the address bar (the `client_id` is in the URL),
   then the permission "Send email on your behalf". Continue.
4. Back in TapNShow: "Sending from <test address>".
5. Create a meeting to the Owner's own test addresses only → Review → Send → the progress reaches
   sent.
6. Open the test inbox: the invite from the group's address; tap "I'm going"; show the answer in
   TapNShow.
7. (Sheets uses `drive.file`, non-sensitive: not needed in the video.)

Never use the club's workspace or members' addresses in the video.
