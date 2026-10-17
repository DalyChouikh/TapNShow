# Workspace Home: design

Date: 2026-10-17. The Owner approved the direction and the mockups (busy and new workspace, phone
and computer). This document is the builder's brief. Parent spec:
`docs/superpowers/specs/2026-10-04-tapnshow-design.md` (§4 Navigation, §7.1, §7.2, §7.7).

## 1. Why

The Owner found Home "too empty and not clear". Checked on 2026-10-17 with seeded screenshots
(`.superpowers/scripts/screens/home-current.spec.ts`):

- The setup checklist never goes away. Only Gmail and Sheets can show Done; "Import your members"
  keeps its button with 30 members imported.
- Past meetings are invisible: 8 meetings with answers show nothing on Home.
- The next meeting is one line of text, "12 going · 6 late · 6 no reply", with no "can't come",
  no time left and no action.
- On a computer it is a strip about 416 px wide.
- With nothing scheduled and setup done, the page is the welcome title and the checklist.

## 2. What Home answers, in this order

1. **What's next, and who's coming?**
2. **What needs me?**
3. **How is my group doing?**

### 2.1 Greeting

- **Returning workspace (setup done):** "Good morning / afternoon / evening, <first name>". The
  time of day comes from the browser's clock. Under it: "<Workspace> · N members · N lists"
  (computer) or "<Workspace> · N members" (phone).
- **New workspace (setup not done):** "Welcome to <Workspace>", then "Two steps and you can send
  your first invite."
- The heading is the page's `h1`.

### 2.2 Next meeting (`NextMeetingCard`, redone)

This is the first card when a meeting is upcoming: the first item of the Meetings "upcoming" tab,
which includes a meeting in progress until it ends.

- **Content:**
  - "NEXT MEETING" with a calendar icon;
  - the title, linking to the meeting;
  - date and time in the meeting's time zone (`formatMeetingWhen`) and a chip with the time left:
    "in 2 days", "in 3 hours", or "Now" while in progress;
  - the place or "Online".
- **Tiles:** the meeting page's `ResultTiles`, reused. Attendance: Going, Late, Absent, No reply;
  RSVP: Going, Not going, No reply; announcements: no tiles. Tiles are 4 across on a computer and
  2 × 2 on phones. On the meeting page they are filter buttons. On Home they are display-only:
  `onFilter` becomes optional, and without it the tiles render as plain boxes, not buttons.
- **Answer line:** "24 of 30 answered", with a progress bar, and ", answers close <deadline>" when
  the meeting has a deadline. While invites are still going out, it says "Sending invites: 12 of 30"
  instead.
- **Actions:**
  - Owner and Admin: the meeting page's `NudgeButton` ("Remind 6 who haven't answered", its
    confirm dialog, its once-every-12-hours rule and its "Reminded N at …" state), reused.
  - **Open meeting** for everyone.
  - While the meeting is in progress, the reminder is gone (`NudgeButton` already hides after the
    start) and **Open meeting** becomes the primary button. The meeting page doesn't open its
    check-in view from a link, and this change doesn't add that.
- **Live:** the card refreshes like the meeting page (`RESULTS_POLL_MS` while visible).
- **Nothing upcoming:** a card that says "No meeting coming up." with **New meeting** (Owner and
  Admin), plus "Create one now; you can send it once Gmail is connected." while there's no sender.

### 2.3 Needs attention

The existing `NeedsAttention`, unchanged in content: a broken sender, drafts waiting for a sender,
and (Owner) a stopped sheet. It shows only when there is something. It sits under the greeting on
phones and at the top of the right column on a computer.

### 2.4 How it's going (new)

For everyone with access, Viewers included.

- **Periods:** History's `PeriodChips` and `periodRange`, reused, default "Last 3 months"
  (`HISTORY_DEFAULT_PERIOD`).
- **Three numbers:**
  - **meetings:** counted meetings in the period;
  - **came on average:** the mean over counted meetings of Going + Late, shown as "23 of 30" (the
    mean invited);
  - **answered before the start:** the share of reachable invitees (email `sent` or `unknown`)
    whose first answer came before the meeting started.
- **Chart:** one stacked bar per counted meeting, oldest to newest, the **newest 12** in the
  period, segmented as Came, Late, Absent, No reply (tile colours, ink outlines), with a legend and
  date labels in each meeting's time zone (every other label below 400 px). Each bar is a link to
  its meeting, labelled "<title>, <date>: 18 came, 4 late, 5 absent, 3 no reply". The note under it
  says "Check-ins where you marked them, otherwise the answers." When the period has more than 12
  meetings, the chart says "The latest 12 of N".
- **Empty states:**
  - no counted meeting ever: "After your first meeting, you'll see here who came, who was late and
    who didn't answer.";
  - none in the chosen period: "No meetings in this period."

### 2.5 Often missing (new)

For everyone with access.

- **Who:** up to 3 roster members (not ad hoc contacts) with the most missed meetings in the
  period, where missed = Absent + No reply. Ties: more Absent first, then name. Members with 0
  missed are never listed.
- **Each row:** initials, name, "Missed 6 of 8: 4 absent, 2 no reply". It opens the person sheet
  in place: the same `ContactSheet` Lists opens (`src/app/(app)/w/[slug]/lists/contact-sheet.tsx`),
  moved to `src/components/members/` if both pages need it.
- **Footer:** "See everyone's attendance" goes to Lists → Attendance.
- Hidden when nobody missed anything in the period.

### 2.6 Get set up (`HomeChecklist`, redone)

For Owner and Admin, until the two required steps are done.

| Step | Done when | Required |
| --- | --- | --- |
| Import your members | the roster has at least one member | yes |
| Connect your group's Gmail | the sender is `active` | yes |
| Invite your committee | another member or a pending invite exists | no |
| Sync answers to Google Sheets | the sheet is connected | no |

- Each step shows **Done** or its button, with "0 of 2 needed" and a bar.
- An Admin sees "Ask <Owner> to connect" for the Owner-only steps, as today.
- Once both required steps are done, the card is gone. If Sheets isn't connected, a small **Sheets
  tip** stays (Owner only) with **Connect** and **Not now**; Not now hides it on that device for
  `REMINDERS_NOT_NOW_DAYS` days, the same rule as the reminders card.
- Viewers keep today's short welcome card instead.

### 2.7 Layout

- **Phones:** one column: greeting, needs attention, next meeting (or get set up when setup isn't
  done), how it's going, often missing, Sheets tip.
- **From `lg`:** two columns, about 3 : 2, centred, `max-w-5xl`. The left column has the next
  meeting (or get set up) and how it's going; the right column has needs attention, often missing
  and the Sheets tip, or "no meeting" and the empty chart while setup isn't done.
- No sideways scroll at 320 px. Every action is at least 44 px.

## 3. Data

### 3.1 `GET /api/workspaces/[slug]/insights?from=&to=` (new)

- Query: `periodQuerySchema`, as History uses it.
- Response (shared Zod schema in `src/shared/api/`):
  - `roster`: `{ members, lists, committee }`. `members` counts roster contacts (`not is_adhoc`).
    `committee` counts the workspace's Admins and Viewers, plus pending invites.
  - `period`: `{ meetings, cameAverage, invitedAverage, answeredBeforeStart }`.
    `answeredBeforeStart` is a share from 0 to 1, or `null` with no reachable invitee.
  - `chart`: up to 12 entries of
    `{ id, title, startsAt, timezone, attending, late, absent, noReply }`, oldest first.
  - `oftenMissing`: up to 3 entries of
    `{ contactId, fullName, invited, missed, absent, noReply }`.
- Route registry: `SIGNED_IN_READ`, `bounded("aggregate counts")`. Any member can read it (Viewers
  too), like Attendance.
- **One SQL function**, `private.workspace_insights(p_workspace, p_from, p_to)`, behind a `public`
  invoker wrapper, listed in `PRIVATE_FUNCTIONS_FOR_AUTHENTICATED`. It is set-based, a single
  statement over the counted meetings.
- **Same rules as Attendance and History:**
  - counted meetings: `status = 'scheduled'`, not `announcement`, `starts_at <= now()`, inside the
    period;
  - each invitee's outcome is `private.effective_status(am.actual, r.status)`;
  - no reply means no outcome and email `sent` or `unknown`;
  - "often missing" uses roster contacts only (`not is_adhoc`).
- **A DB test pins the twins:** for the same period, `oftenMissing` and the totals equal what
  `private.attendance_summary` gives.
- **Performance:** measured with `EXPLAIN` on a volume seed of one workspace with 2,000 contacts
  and 150 past meetings × 2,000 invitees (300,000 invitee rows), plus 200 small workspaces. Target:
  under 100 ms warm. Indexes are added only if the plan needs them, partial to this reader.

### 3.2 Reused as they are

`GET …/meetings?tab=upcoming` (the next meeting), `GET …/meetings/[id]` and `…/results` (the
card's details, tiles, nudge state), `POST …/nudge`, the sender and sheet hooks, `PeriodChips`,
`periodRange`, `ResultTiles` (with `onFilter` made optional), `NudgeButton`, `NeedsAttention`,
`ContactSheet`.

## 4. Edge cases

| # | Case | Behaviour | Pinned by |
| --- | --- | --- | --- |
| 1 | No meeting ever | Next: "No meeting coming up"; chart empty state; no often missing | component tests |
| 2 | Meetings, none in the period | Numbers show 0 meetings; "No meetings in this period" | component + DB test |
| 3 | Next meeting in progress | "Now" chip; no reminder; Open meeting is primary; listed until it ends | component test |
| 4 | Next meeting's invites still queued | "Sending invites: X of N" | component test |
| 5 | Announcement / RSVP next | No tiles / RSVP tiles (ResultTiles) | component test |
| 6 | Cancelled, draft, announcement meetings | Never counted | DB test |
| 7 | Check-in differs from the answer | The check-in wins | DB test |
| 8 | Ad hoc people | In the chart totals; never in often missing | DB test |
| 9 | Unsubscribed or failed email | Neither no reply nor answered (the existing rule) | DB test |
| 10 | Answer after the start | Counted as answered, not "before the start" (first answer's `responded_at`) | DB test |
| 11 | More than 12 meetings in the period | Newest 12, "The latest 12 of N" | DB + component test |
| 12 | Ties in often missing | More absent first, then name | DB test |
| 13 | A Viewer, a non-member | Viewer reads it; a non-member gets 403/404 like Attendance | DB + route test |
| 14 | Time zones | Calendar periods in the workspace zone (`periodRange`); dates in the meeting's zone | existing + component tests |
| 15 | Setup half done; Admin vs Owner | Done states; "Ask <Owner>" for Admins | component tests |
| 16 | Sheets tip dismissed | Hidden on that device for 30 days; back after | component test |
| 17 | Large workspace | Set-based; plan measured on the volume seed | DB test + EXPLAIN in the ledger |
| 18 | Slow or failed load | Each card has its own skeleton and its own retry, so one failure doesn't blank Home | component tests |
| 19 | 320 px, dark mode, 1024 | No sideways scroll; tokens only | screenshots |
| 20 | Screen readers | The chart has a label per bar and a text summary (the three numbers) | component test |

## 5. Goals, non-goals, anti-goals

- **Goals:** Home answers the three questions at a glance, on phones and computers, for every role.
- **Non-goals:** no new kinds of charts elsewhere; no export from Home; no per-list filter on Home
  (Lists → Attendance has it); no change to the meeting page beyond `ResultTiles`' optional
  `onFilter`.
- **Anti-goals:**
  - a second implementation of the counting rules (it must reuse `effective_status` and match
    Attendance);
  - fake or decorative numbers;
  - charts without a text alternative;
  - a page that loads everything in one blocking request.

## 6. Docs to update with the change

Parent spec:
- §4 Navigation: Home's content.
- §7.1: the checklist's Done states, and that it disappears.
- §7.7: Home's next-meeting card and "How it's going".
- §15: nothing.

## 7. Left to the builder

- Exact spacing, and the empty and skeleton copy within these meanings.
- How the time-left chip is worded at each range (date-fns `formatDistanceToNowStrict`, with the
  copy in `messages/en.json`).
- Whether the SQL is one function with CTEs or a function plus a helper, as long as it is
  set-based and measured.
