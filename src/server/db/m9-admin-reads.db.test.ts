import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { sqlNullable } from "@/server/db/rpc-args";
import { createTestUser, type TestUser } from "@/test/db/clients";
import { seedMeeting } from "@/test/db/meetings";
import { clearPlatformAdmins, makePlatformAdmin } from "@/test/db/platform";
import { seedEmailedPeople, seedReport } from "@/test/db/reports";
import { queryLocalSql, runLocalScript, runLocalSql } from "@/test/db/sql";
import { createWorkspaceAs } from "@/test/db/workspaces";

beforeEach(() => clearPlatformAdmins());

async function adminAndWorkspace(name: string, people: number) {
  const admin = await createTestUser();
  makePlatformAdmin(admin);
  const owner = await createTestUser({ fullName: "Owner Person" });
  const workspace = await createWorkspaceAs(owner, name);
  const meetingId = await seedMeeting(workspace.id, {
    status: "scheduled",
    created_by: owner.id,
  });
  seedEmailedPeople(workspace.id, meetingId, people);
  return { admin, owner, workspace };
}

/** Each admin read, called as `user` (the pages' first-page arguments). */
const ADMIN_READS: Array<
  [
    string,
    (user: TestUser) => PromiseLike<{ error: { message: string } | null }>,
  ]
> = [
  [
    "admin_overview",
    (user) => user.client.rpc("admin_overview", { p_days: 30 }),
  ],
  [
    "admin_workspaces",
    (user) =>
      user.client.rpc("admin_workspaces", {
        p_search: sqlNullable<string>(null),
        p_filter: "all",
        p_sort: "newest",
        p_after_value: sqlNullable<string>(null),
        p_after_id: sqlNullable<string>(null),
        p_limit: 25,
      }),
  ],
  [
    "admin_reports",
    (user) =>
      user.client.rpc("admin_reports", {
        p_after_at: sqlNullable<string>(null),
        p_after_id: sqlNullable<string>(null),
        p_limit: 25,
      }),
  ],
  [
    "admin_log",
    (user) =>
      user.client.rpc("admin_log", {
        p_filter: "all",
        p_after_id: sqlNullable<number>(null),
        p_limit: 25,
      }),
  ],
];

describe("admin reads are for platform admins only", () => {
  it.each(ADMIN_READS)(
    "%s refuses a workspace Owner with not_found",
    async (_name, read) => {
      const owner = await createTestUser();
      expect((await read(owner)).error?.message).toBe("tn:not_found");
    },
  );
});

describe("admin_workspaces", () => {
  it("lists health per workspace, never contact names or emails, masked Owner email", async () => {
    const { admin, owner, workspace } = await adminAndWorkspace(
      "Health Club",
      10,
    );
    seedReport(workspace.id);
    const { data, error } = await admin.client.rpc("admin_workspaces", {
      p_search: "health",
      p_filter: "reported",
      p_sort: "reports",
      p_after_value: sqlNullable<string>(null),
      p_after_id: sqlNullable<string>(null),
      p_limit: 25,
    });
    expect(error).toBeNull();
    const row = (
      data as { items: Array<Record<string, string | number | boolean>> }
    ).items.find((item) => item.id === workspace.id);
    expect(row).toMatchObject({
      name: "Health Club",
      team: 1,
      emails_30d: 10,
      reports_7d: 1,
      people_7d: 10,
      suspended: false,
      sender: "none",
      sheet: "off",
    });
    expect(String(row?.owner_email)).toMatch(/^.•••@example\.test$/);
    expect(JSON.stringify(data)).not.toMatch(/p\d+-.*@example\.test/);
    expect(owner.email).not.toBe(row?.owner_email);
  });

  it.each([
    ["newest", "not-a-time"],
    ["reports", "2026-10-16 10:00:00+00"],
    ["emails", "99999999999999999999"],
  ])(
    "answers invalid input to a %s cursor that doesn't fit the sort",
    async (sort, value) => {
      const admin = await createTestUser();
      makePlatformAdmin(admin);
      const { error } = await admin.client.rpc("admin_workspaces", {
        p_search: sqlNullable<string>(null),
        p_filter: "all",
        p_sort: sort,
        p_after_value: value,
        p_after_id: "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
        p_limit: 25,
      });
      expect(error?.message).toBe("tn:invalid_input");
    },
  );

  it("pages by keyset with no duplicates or gaps", async () => {
    const admin = await createTestUser();
    makePlatformAdmin(admin);
    const owner = await createTestUser();
    // A stamp per run: the local database keeps earlier runs' workspaces.
    const stamp = crypto.randomUUID().slice(0, 8);
    for (let i = 0; i < 5; i += 1)
      await createWorkspaceAs(owner, `Paging ${stamp} ${i}`);
    const seen: string[] = [];
    let after: { value: string | null; id: string | null } = {
      value: null,
      id: null,
    };
    for (let page = 0; page < 10; page += 1) {
      const { data } = await admin.client.rpc("admin_workspaces", {
        p_search: `paging ${stamp}`,
        p_filter: "all",
        p_sort: "newest",
        p_after_value: sqlNullable(after.value),
        p_after_id: sqlNullable(after.id),
        p_limit: 2,
      });
      const items = (
        data as { items: Array<{ id: string; sort_value: string }> }
      ).items;
      if (items.length === 0) break;
      seen.push(...items.map((item) => item.id));
      const last = items.at(-1)!;
      after = { value: last.sort_value, id: last.id };
    }
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });
});

describe("admin_workspace, reports and the log", () => {
  it("shows the full Owner email for copying, the 30-day figures and the suspension history", async () => {
    const { admin, owner, workspace } = await adminAndWorkspace(
      "Detail Club",
      4,
    );
    await admin.client.rpc("admin_suspend", { p_workspace: workspace.id });
    await admin.client.rpc("admin_lift", { p_workspace: workspace.id });
    const { data } = await admin.client.rpc("admin_workspace", {
      p_workspace: workspace.id,
    });
    const detail = data as {
      owner_email: string;
      last_30: { emails_sent: number };
      suspensions: Array<{ reason: string; lifted_at: string | null }>;
    };
    expect(detail.owner_email).toBe(owner.email);
    expect(detail.last_30).toMatchObject({ emails_sent: 4 });
    expect(detail.suspensions).toHaveLength(1);
    expect(detail.suspensions[0].reason).toBe("platform_admin");
    expect(detail.suspensions[0].lifted_at).not.toBeNull();
  });

  it("marks a report reviewed once, logged with the reviewer", async () => {
    const { admin, workspace } = await adminAndWorkspace("Report Club", 3);
    seedReport(workspace.id);
    const { data } = await admin.client.rpc("admin_reports", {
      p_after_at: sqlNullable<string>(null),
      p_after_id: sqlNullable<string>(null),
      p_limit: 25,
    });
    const report = (
      data as {
        items: Array<{
          id: string;
          workspace_id: string;
          reviewed_at: string | null;
        }>;
      }
    ).items.find((item) => item.workspace_id === workspace.id)!;
    expect(report.reviewed_at).toBeNull();
    expect(
      (await admin.client.rpc("admin_mark_reviewed", { p_report: report.id }))
        .error,
    ).toBeNull();
    expect(
      (await admin.client.rpc("admin_mark_reviewed", { p_report: report.id }))
        .error,
    ).toBeNull();
    const reviewed = queryLocalSql(
      `select count(*)::int as n from public.platform_events where kind = 'report_reviewed' and workspace_id = '${workspace.id}'`,
      z.array(z.object({ n: z.number() })).length(1),
    );
    expect(reviewed[0].n).toBe(1);
  });

  it("filters the log and names the actor", async () => {
    const { admin, workspace } = await adminAndWorkspace("Log Club", 1);
    await admin.client.rpc("admin_suspend", { p_workspace: workspace.id });
    const { data } = await admin.client.rpc("admin_log", {
      p_filter: "suspensions",
      p_after_id: sqlNullable<number>(null),
      p_limit: 25,
    });
    const items = (
      data as { items: Array<{ kind: string; workspace_name: string }> }
    ).items;
    expect(
      items.every((item) =>
        ["auto_suspended", "suspended", "lifted"].includes(item.kind),
      ),
    ).toBe(true);
    expect(items[0]).toMatchObject({
      kind: "suspended",
      workspace_name: "Log Club",
    });
  });
});

describe("edges (Review Focus 3 and 4)", () => {
  it("never counts an email twice across midnight UTC (rolled yesterday + live today)", async () => {
    const { admin, workspace } = await adminAndWorkspace("Midnight Club", 2);
    runLocalSql(`
      with rows as (select id, row_number() over (order by id) as n from public.send_log where workspace_id = '${workspace.id}')
      update public.send_log l set sent_at = case when r.n = 1
          then date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' - interval '1 minute'
          else date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' + interval '1 minute' end
      from rows r where r.id = l.id`);
    runLocalSql("select private.rollup_platform_daily()");
    const { data } = await admin.client.rpc("admin_workspace", {
      p_workspace: workspace.id,
    });
    expect(
      (data as { last_30: { emails_sent: number } }).last_30.emails_sent,
    ).toBe(2);
  });

  it("counts yesterday's late email before the night's rollup has run (00:00 to 03:17 UTC)", async () => {
    const { admin, workspace } = await adminAndWorkspace("Night Club", 2);
    const mark = queryLocalSql(
      "select rolled_through::text as day from public.platform_rollup_state",
      z.array(z.object({ day: z.string() })),
    );
    try {
      runLocalSql(`
        with rows as (select id, row_number() over (order by id) as n from public.send_log where workspace_id = '${workspace.id}')
        update public.send_log l set sent_at = case when r.n = 1
            then date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' - interval '1 minute'
            else date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' + interval '1 minute' end
        from rows r where r.id = l.id`);
      // Last night's rollup ran; tonight's hasn't yet.
      runLocalScript(`
        delete from public.platform_daily where workspace_id = '${workspace.id}';
        insert into public.platform_rollup_state (id, rolled_through)
        values (true, (now() at time zone 'UTC')::date - 2)
        on conflict (id) do update set rolled_through = excluded.rolled_through`);
      const { data } = await admin.client.rpc("admin_workspace", {
        p_workspace: workspace.id,
      });
      expect(
        (data as { last_30: { emails_sent: number } }).last_30.emails_sent,
      ).toBe(2);
    } finally {
      runLocalSql(
        mark[0]
          ? `update public.platform_rollup_state set rolled_through = '${mark[0].day}'`
          : "delete from public.platform_rollup_state",
      );
    }
  });

  it("records how far the rollup has counted", async () => {
    runLocalSql("select private.rollup_platform_daily()");
    const mark = queryLocalSql(
      "select rolled_through = (now() at time zone 'UTC')::date - 1 as yesterday from public.platform_rollup_state",
      z.array(z.object({ yesterday: z.boolean() })).length(1),
    );
    expect(mark[0].yesterday).toBe(true);
  });

  it("counts today's failed emails in a workspace's 30 days", async () => {
    const { admin, workspace } = await adminAndWorkspace("Failing Club", 2);
    runLocalSql(
      `update public.outbox_jobs set status = 'failed', updated_at = now() where workspace_id = '${workspace.id}'`,
    );
    const { data } = await admin.client.rpc("admin_workspace", {
      p_workspace: workspace.id,
    });
    expect(
      (data as { last_30: { emails_failed: number } }).last_30.emails_failed,
    ).toBe(2);
  });

  it("drops a deleted workspace's emails from today's figures too", async () => {
    const { admin, owner, workspace } = await adminAndWorkspace(
      "Short Club",
      2,
    );
    const sent = async () =>
      (
        (await admin.client.rpc("admin_overview", { p_days: 7 })).data as {
          current: { emails_sent: number };
        }
      ).current.emails_sent;
    const before = await sent();
    const deleted = await owner.client.rpc("delete_workspace", {
      p_workspace: workspace.id,
      p_confirm_name: "Short Club",
    });
    expect(deleted.error).toBeNull();
    expect(before - (await sent())).toBe(2);
  });

  it("counts a day in one period only (the periods start at a UTC midnight)", async () => {
    const { admin, workspace } = await adminAndWorkspace("Edge Club", 1);
    runLocalSql("select private.rollup_platform_daily()");
    const figures = async () => {
      const data = (await admin.client.rpc("admin_overview", { p_days: 7 }))
        .data as {
        current: { emails_sent: number };
        previous: { emails_sent: number };
      };
      return [data.current.emails_sent, data.previous.emails_sent];
    };
    const [current, previous] = await figures();
    // One minute before the 7-day period's first midnight: the previous period's last day.
    runLocalScript(`
      update public.send_log set sent_at =
        date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' - interval '6 days' - interval '1 minute'
      where workspace_id = '${workspace.id}';
      select private.rollup_platform_daily();`);
    expect(await figures()).toEqual([current - 1, previous + 1]);
  });

  it("keeps a deleted workspace's events in the log by name, and its page is not found", async () => {
    const { admin, owner, workspace } = await adminAndWorkspace("Gone Club", 1);
    await admin.client.rpc("admin_suspend", { p_workspace: workspace.id });
    const deleted = await owner.client.rpc("delete_workspace", {
      p_workspace: workspace.id,
      p_confirm_name: "Gone Club",
    });
    expect(deleted.error).toBeNull();
    const { data } = await admin.client.rpc("admin_log", {
      p_filter: "suspensions",
      p_after_id: sqlNullable<number>(null),
      p_limit: 25,
    });
    const item = (
      data as {
        items: Array<{ workspace_id: string | null; workspace_name: string }>;
      }
    ).items.find((entry) => entry.workspace_name === "Gone Club");
    expect(item?.workspace_id).toBeNull();
    expect(
      (await admin.client.rpc("admin_workspace", { p_workspace: workspace.id }))
        .error?.message,
    ).toBe("tn:not_found");
  });
});

describe("rollup and overview", () => {
  it("rolls up the last 29 days idempotently and keeps the push counters", async () => {
    const { admin, workspace } = await adminAndWorkspace("Rollup Club", 3);
    runLocalSql(
      `update public.send_log set sent_at = now() - interval '2 days' where workspace_id = '${workspace.id}'`,
    );
    runLocalSql(
      `insert into public.platform_daily (day, workspace_id, pushes_sent) values ((now() - interval '2 days')::date, '${workspace.id}', 7)`,
    );
    // Twice: the rollup is an idempotent upsert.
    runLocalSql("select private.rollup_platform_daily()");
    runLocalSql("select private.rollup_platform_daily()");
    const row = queryLocalSql(
      `select emails_sent, people_emailed, pushes_sent from public.platform_daily where workspace_id = '${workspace.id}' and day = (now() - interval '2 days')::date`,
      z
        .array(
          z.object({
            emails_sent: z.number(),
            people_emailed: z.number(),
            pushes_sent: z.number(),
          }),
        )
        .length(1),
    );
    expect(row[0]).toEqual({
      emails_sent: 3,
      people_emailed: 3,
      pushes_sent: 7,
    });
    const { data } = await admin.client.rpc("admin_overview", { p_days: 7 });
    const overview = data as {
      current: { emails_sent: number; pushes_sent: number };
      weekly: Array<{ week: string; meetings: number }>;
    };
    expect(overview.current.emails_sent).toBeGreaterThanOrEqual(3);
    expect(overview.weekly).toHaveLength(12);
  });
});
