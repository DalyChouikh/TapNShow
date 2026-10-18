import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createTestUser, type TestUser } from "@/test/db/clients";
import { withLimit } from "@/test/db/limits";
import {
  explainCall,
  functionCalls,
  planUsesIndex,
  timeCall,
} from "@/test/db/plans";
import { queryLocalSql, runLocalScript, runLocalSql } from "@/test/db/sql";

/** Three years of weekly meetings in the busy workspace. */
const MEETINGS = 150;
/** …next to many small ones sharing the tables. */
const SMALL_WORKSPACES = 200;
const SMALL_CONTACTS = 50;
const SMALL_MEETINGS = 10;
/**
 * The slowest Home's insights and Lists → Attendance may answer, warm, for their default period
 * (Last 3 months, `HISTORY_DEFAULT_PERIOD`).
 */
const DEFAULT_PERIOD_BUDGET_MS = 100;
/**
 * …and for "All time" at the caps: every invitee row of three years, about 1 µs each, already
 * index-only (insights measured warm: 72 ms locally, 124 ms on the CI runner). The plan
 * assertions below pin the shape that keeps it there on any machine.
 */
const ALL_TIME_BUDGET_MS = 250;
/** `private.effective_status` runs once per (check-in, answer) pair, never per invitee row. */
const EFFECTIVE_STATUS =
  "private.effective_status(public.attendance_actual, public.response_status)";
/** Names this run's workspaces, so a rerun on the same database finds its own. */
const RUN = crypto.randomUUID().slice(0, 6);
/** The tables the read joins, vacuumed and analyzed after seeding as autovacuum keeps them. */
const READ_TABLES = [
  "public.workspaces",
  "public.workspace_roles",
  "public.contacts",
  "public.meetings",
  "public.meeting_invitees",
  "public.responses",
  "public.attendance_marks",
];

let owner: TestUser;
let big: string;
let small: string;

/**
 * Seeds one transaction. The busy workspace is at the product's caps (`private.app_limits`): a full
 * roster, and every meeting invites as many people as one meeting may, a rotating window so every
 * member is invited. Answers on 80% of invitees (the first answer a day before the start),
 * check-ins on about half the meetings.
 */
function seedVolume(ownerId: string): void {
  runLocalScript(`
    create temp table plan_ws on commit drop as
      select gen_random_uuid() as id, g,
        case when g = 0 then private.app_limit('contacts_per_workspace_max') else ${SMALL_CONTACTS} end as people,
        case when g = 0 then ${MEETINGS} else ${SMALL_MEETINGS} end as meetings
      from generate_series(0, ${SMALL_WORKSPACES}) g;
    insert into public.workspaces (id, name, slug, timezone)
      select id, 'Attendance Club ${RUN} ' || g, 'attendance-' || g || '-' || left(id::text, 8), 'Africa/Tunis'
      from plan_ws;
    insert into public.workspace_roles (workspace_id, user_id, role)
      select id, '${ownerId}', 'owner' from plan_ws;
    insert into public.contacts (workspace_id, email, full_name)
      select w.id, 'p' || n || '@' || left(w.id::text, 8) || '.example.test', 'Person ' || n
      from plan_ws w, generate_series(1, w.people) n;
    insert into public.meetings (workspace_id, title, starts_at, duration_minutes, timezone, location_mode,
        location_text, response_mode, delay_options, reason_required, comments_enabled, status, sent_at, created_by)
      select w.id, 'Weekly sync ' || k, now() - make_interval(days => 7 * k), 60, 'Africa/Tunis', 'in_person',
        'Room 4', 'attendance', '{5,10,15,30}', true, false, 'scheduled', now() - make_interval(days => 7 * k + 3),
        '${ownerId}'
      from plan_ws w, generate_series(1, w.meetings) k;
    insert into public.meeting_invitees (workspace_id, meeting_id, contact_id, email_status, sent_at)
      select w.id, m.id, c.id, 'sent', m.sent_at
      from plan_ws w
      cross join lateral (select least(w.people, private.app_limit('invitees_per_meeting_max')) as seats) cap
      join (select m.*, row_number() over (partition by m.workspace_id order by m.starts_at) as k
        from public.meetings m) m on m.workspace_id = w.id
      join (select c.*, row_number() over (partition by c.workspace_id order by c.email) as n
        from public.contacts c) c on c.workspace_id = w.id
      where (c.n + m.k * cap.seats) % w.people < cap.seats;
    insert into public.responses (workspace_id, meeting_id, invitee_id, status, delay_minutes, responded_at)
      select i.workspace_id, i.meeting_id, i.id,
        (array['attending', 'late', 'absent', 'not_attending'])[1 + abs(hashtext(i.id::text)) % 4]::public.response_status,
        case when abs(hashtext(i.id::text)) % 4 = 1 then 10 end, m.starts_at - interval '1 day'
      from plan_ws w
      join public.meeting_invitees i on i.workspace_id = w.id
      join public.meetings m on m.id = i.meeting_id
      where abs(hashtext(i.id::text || 'answered')) % 10 < 8;
    insert into public.attendance_marks (invitee_id, workspace_id, meeting_id, actual)
      select i.id, i.workspace_id, i.meeting_id,
        (array['present', 'late', 'absent'])[1 + abs(hashtext(i.id::text || 'mark')) % 3]::public.attendance_actual
      from plan_ws w
      join public.meeting_invitees i on i.workspace_id = w.id
      where abs(hashtext(i.meeting_id::text)) % 2 = 0;
  `);
}

beforeAll(async () => {
  owner = await createTestUser();
  await withLimit(
    "workspace_seats_per_user_max",
    SMALL_WORKSPACES + 10,
    async () => seedVolume(owner.id),
  );
  for (const table of READ_TABLES) {
    runLocalSql(`vacuum analyze ${table}`);
  }
  const ids = queryLocalSql(
    `select id::text as id from public.workspaces
     where name in ('Attendance Club ${RUN} 0', 'Attendance Club ${RUN} 100') order by name`,
    z.array(z.object({ id: z.string() })).length(2),
  );
  [big, small] = ids.map((row) => row.id);
}, 600_000);

/** Both reads take (workspace, from, to); "to" is open here, as the default periods leave it. */
const READS = ["workspace_insights", "attendance_summary"] as const;
type Read = (typeof READS)[number];
const call = (read: Read, workspaceId: string, from: string) =>
  `public.${read}('${workspaceId}', ${from}, null)`;

const ALL_TIME = "null";
const LAST_3_MONTHS = "now() - interval '3 months'";

/** The (check-in, answer) pairs: each enum's values, plus "none". */
function outcomePairs(): number {
  const [row] = queryLocalSql(
    `select ((select count(*) from unnest(enum_range(null::public.attendance_actual))) + 1)
       * ((select count(*) from unnest(enum_range(null::public.response_status))) + 1) as pairs`,
    z.array(z.object({ pairs: z.coerce.number() })).length(1),
  );
  return row.pairs;
}

describe(`Home insights and Lists → Attendance at the roster and per-meeting caps × ${MEETINGS} meetings, next to ${SMALL_WORKSPACES} small workspaces`, () => {
  it.each(
    READS.flatMap((read) => [
      [read, "Last 3 months", DEFAULT_PERIOD_BUDGET_MS, LAST_3_MONTHS] as const,
      [read, "All time", ALL_TIME_BUDGET_MS, ALL_TIME] as const,
    ]),
  )(
    "%s reads %s on the big workspace within %s ms",
    (read, _, budget, from) => {
      expect(timeCall(call(read, big, from), owner.id)).toBeLessThanOrEqual(
        budget,
      );
    },
  );

  it.each(READS)(
    "%s decides each outcome once per (check-in, answer) pair",
    (read) => {
      expect(
        functionCalls(call(read, big, ALL_TIME), owner.id, EFFECTIVE_STATUS),
      ).toBeLessThanOrEqual(outcomePairs());
    },
  );

  it.each(READS)(
    "%s reads meetings by the workspace index, and each meeting's people index-only",
    (read) => {
      for (const from of [ALL_TIME, LAST_3_MONTHS]) {
        const plan = explainCall(call(read, big, from), owner.id);
        expect(plan).not.toMatch(/Seq Scan on meetings\b/);
        for (const index of [
          "meeting_invitees_meeting_ws_idx",
          "responses_meeting_ws_idx",
          "attendance_marks_meeting_idx",
        ]) {
          expect(plan, index).toMatch(
            new RegExp(`Index Only Scan using ${index}\\b`),
          );
        }
      }
    },
  );

  it.each(READS)(
    "%s on a small workspace reads only its own rows (no whole-table scan)",
    (read) => {
      const plan = explainCall(call(read, small, ALL_TIME), owner.id);
      for (const table of [
        "meetings",
        "meeting_invitees",
        "responses",
        "attendance_marks",
        "contacts",
      ]) {
        expect(plan, table).not.toMatch(new RegExp(`Seq Scan on ${table}\\b`));
      }
      expect(planUsesIndex(plan, "meeting_invitees_meeting_ws_idx")).toBe(true);
    },
  );
});
