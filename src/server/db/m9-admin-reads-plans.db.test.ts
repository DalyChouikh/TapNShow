import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { createTestUser, type TestUser } from "@/test/db/clients";
import { withLimit } from "@/test/db/limits";
import { clearPlatformAdmins, makePlatformAdmin } from "@/test/db/platform";
import { explainCall, planUsesIndex, timeCall } from "@/test/db/plans";
import { queryLocalSql, runLocalScript, runLocalSql } from "@/test/db/sql";

/** A realistic first year (Task 16 ruling): 200 workspaces × 200 contacts, 20k emails over 20 days. */
const WORKSPACES = 200;
const CONTACTS = 200;
const EMAILED = 100;
/** The slowest an admin page's read may take at that volume. */
const READ_BUDGET_MS = 500;
/** Names this run's workspaces, so a rerun on the same database finds its own sample. */
const RUN = crypto.randomUUID().slice(0, 6);

let admin: TestUser;
let sample: string;

/** Seeds the volume in one transaction (the owner holds every seat; the cap is raised meanwhile). */
function seedVolume(ownerId: string): void {
  runLocalScript(`
    create temp table plan_ws on commit drop as
      select gen_random_uuid() as id, g from generate_series(1, ${WORKSPACES}) g;
    insert into public.workspaces (id, name, slug, timezone, created_at)
      select id, 'Plan Club ${RUN} ' || g, 'plan-club-' || g || '-' || left(id::text, 4), 'Africa/Tunis',
        now() - make_interval(hours => g)
      from plan_ws;
    insert into public.workspace_roles (workspace_id, user_id, role)
      select id, '${ownerId}', 'owner' from plan_ws;
    insert into public.contacts (workspace_id, email, full_name)
      select w.id, 'c' || c || '@' || left(w.id::text, 8) || '.example.test', 'Contact ' || c
      from plan_ws w, generate_series(1, ${CONTACTS}) c;
    create temp table plan_m on commit drop as
      select gen_random_uuid() as id, w.id as workspace_id from plan_ws w;
    insert into public.meetings (id, workspace_id, title, starts_at, duration_minutes, timezone,
        location_mode, location_text, response_mode, delay_options, reason_required, comments_enabled,
        status, sent_at, created_by)
      select id, workspace_id, 'Plan meeting', now() + interval '2 days', 60, 'Africa/Tunis',
        'in_person', 'Room B12', 'attendance', '{5,10,15,30}', true, false,
        'scheduled', now() - interval '10 days', '${ownerId}'
      from plan_m;
    create temp table plan_i on commit drop as
      select gen_random_uuid() as id, gen_random_uuid() as job_id, m.workspace_id, m.id as meeting_id,
        c.id as contact_id, row_number() over (partition by m.id order by c.id) as n
      from plan_m m join public.contacts c on c.workspace_id = m.workspace_id;
    delete from plan_i where n > ${EMAILED};
    insert into public.meeting_invitees (id, workspace_id, meeting_id, contact_id, email_status, sent_at)
      select id, workspace_id, meeting_id, contact_id, 'sent', now() - make_interval(days => (n % 20)::int)
      from plan_i;
    insert into public.outbox_jobs (id, kind, workspace_id, meeting_id, invitee_id, payload,
        idempotency_key, status, updated_at)
      select job_id, 'invite', workspace_id, meeting_id, id, '{}'::jsonb, 'plan:' || id, 'done',
        now() - make_interval(days => (n % 20)::int)
      from plan_i;
    insert into public.send_log (google_sub, workspace_id, job_id, sent_at)
      select 'sub-plan', workspace_id, job_id, now() - make_interval(days => (n % 20)::int, mins => (n % 600)::int)
      from plan_i;
    insert into public.abuse_reports (workspace_id, contact_id, reported_at)
      select i.workspace_id, i.contact_id, now() - interval '1 day' from plan_i i where i.n <= 2;
    select private.rollup_platform_daily();
  `);
}

beforeAll(async () => {
  clearPlatformAdmins();
  admin = await createTestUser();
  makePlatformAdmin(admin);
  const owner = await createTestUser();
  await withLimit("workspace_seats_per_user_max", WORKSPACES + 10, async () =>
    seedVolume(owner.id),
  );
  runLocalSql(
    "analyze public.workspaces, public.workspace_roles, public.contacts, public.meetings, public.meeting_invitees, public.outbox_jobs, public.send_log, public.abuse_reports, public.platform_daily",
  );
  sample = queryLocalSql(
    `select id::text as id from public.workspaces where name = 'Plan Club ${RUN} 100'`,
    z.array(z.object({ id: z.string() })).length(1),
  )[0].id;
}, 180_000);

/** Every admin read, as the admin pages call them. */
const READS = () => ({
  overview:
    "public.admin_overview((now() at time zone 'UTC')::date - 29, (now() at time zone 'UTC')::date)",
  workspaces: "public.admin_workspaces(null, 'all', 'emails', null, null, 26)",
  "workspaces (search)":
    "public.admin_workspaces('plan club 1', 'reported', 'reports', null, null, 26)",
  workspace: `public.admin_workspace('${sample}')`,
  reports: "public.admin_reports(null, null, 26)",
  log: "public.admin_log('all', null, 26)",
});

/**
 * The single-workspace pages read the big tables through their workspace indexes only. outbox_jobs
 * is hash-joined by primary key (about 1 ms at 20k rows) and abuse_reports is small, so the
 * planner's choice for those is left to it (Task 16 ruling).
 */
function expectOwnWorkspacesOnly(name: "workspace" | "reports"): void {
  const plan = explainCall(READS()[name], admin.id);
  for (const table of [
    "contacts",
    "send_log",
    "meeting_invitees",
    "platform_daily",
  ]) {
    expect(plan, table).not.toMatch(new RegExp(`Seq Scan on ${table}\\b`));
  }
}

describe(`admin reads at ${WORKSPACES} workspaces × ${CONTACTS} contacts`, () => {
  it.each(Object.keys(READS()))("%s answers within the budget", (name) => {
    const call = READS()[name as keyof ReturnType<typeof READS>];
    expect(timeCall(call, admin.id)).toBeLessThan(READ_BUDGET_MS);
  });

  it("pages reports and the log through their keyset indexes", () => {
    const reports = explainCall(READS().reports, admin.id);
    expect(planUsesIndex(reports, "abuse_reports_page_idx")).toBe(true);
    const log = explainCall(READS().log, admin.id);
    expect(log).not.toMatch(/Seq Scan on platform_events\b/);
  });

  it.each(["workspace", "reports"] as const)(
    "the %s page reads only its own workspaces (no whole-table scan of the big tables)",
    (name) => expectOwnWorkspacesOnly(name),
  );
});

describe("with stale statistics (a second batch, not analyzed)", () => {
  beforeAll(async () => {
    const owner = await createTestUser();
    await withLimit("workspace_seats_per_user_max", WORKSPACES + 10, async () =>
      seedVolume(owner.id),
    );
  }, 180_000);

  it.each(Object.keys(READS()))(
    "%s still answers within the budget",
    (name) => {
      const call = READS()[name as keyof ReturnType<typeof READS>];
      expect(timeCall(call, admin.id)).toBeLessThan(READ_BUDGET_MS);
    },
  );

  it.each(["workspace", "reports"] as const)(
    "the %s page still reads only its own workspaces",
    (name) => expectOwnWorkspacesOnly(name),
  );
});
