import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { adminClient, createTestUser } from "@/test/db/clients";
import { seedInvitee } from "@/test/db/invitees";
import { withLimit } from "@/test/db/limits";
import { seedMeeting } from "@/test/db/meetings";
import { clearPlatformAdmins, makePlatformAdmin } from "@/test/db/platform";
import { seedEmailedPeople, seedReport } from "@/test/db/reports";
import { seedConnection, setSender } from "@/test/db/sender";
import { queryLocalSql, runLocalSql } from "@/test/db/sql";
import { createWorkspaceAs } from "@/test/db/workspaces";

const count = z.array(z.object({ n: z.number() })).length(1);
const openSuspensions = (workspaceId: string) =>
  queryLocalSql(
    `select count(*)::int as n from public.workspace_sending_suspensions where workspace_id = '${workspaceId}' and lifted_at is null`,
    count,
  )[0].n;

async function workspaceWithPeople(people: number) {
  const owner = await createTestUser();
  const workspace = await createWorkspaceAs(owner, "Suspension Club");
  const meetingId = await seedMeeting(workspace.id, {
    status: "scheduled",
    created_by: owner.id,
  });
  seedEmailedPeople(workspace.id, meetingId, people);
  return { owner, workspace, meetingId };
}

beforeEach(() => clearPlatformAdmins());

describe("automatic suspension (spec §7.12)", () => {
  it("needs both 3 reports and 2% of the people emailed in 7 days", async () => {
    const big = await workspaceWithPeople(200);
    for (let i = 0; i < 3; i += 1) seedReport(big.workspace.id);
    expect(openSuspensions(big.workspace.id)).toBe(0); // 3 / 200 = 1.5%
    seedReport(big.workspace.id);
    expect(openSuspensions(big.workspace.id)).toBe(1); // 4 / 200 = 2%, exactly the threshold
  });

  it("two reports are never enough, whatever the rate", async () => {
    const small = await workspaceWithPeople(5);
    seedReport(small.workspace.id);
    seedReport(small.workspace.id);
    expect(openSuspensions(small.workspace.id)).toBe(0);
  });

  it("ignores reports older than the window and before the last lift", async () => {
    const { workspace } = await workspaceWithPeople(10);
    seedReport(workspace.id, "8 days");
    seedReport(workspace.id, "8 days");
    seedReport(workspace.id);
    expect(openSuspensions(workspace.id)).toBe(0);
    seedReport(workspace.id);
    seedReport(workspace.id);
    expect(openSuspensions(workspace.id)).toBe(1);
    runLocalSql(`select private.lift_suspension('${workspace.id}', null)`);
    seedReport(workspace.id);
    expect(openSuspensions(workspace.id)).toBe(0);
  });

  it("opens one suspension when reports arrive at once", async () => {
    const { workspace } = await workspaceWithPeople(10);
    seedReport(workspace.id);
    seedReport(workspace.id);
    await Promise.all([
      adminClient()
        .from("abuse_reports")
        .insert({ workspace_id: workspace.id }),
      adminClient()
        .from("abuse_reports")
        .insert({ workspace_id: workspace.id }),
    ]);
    expect(openSuspensions(workspace.id)).toBe(1);
  });

  it("logs every report and the suspension, with counts only", async () => {
    const { workspace } = await workspaceWithPeople(10);
    for (let i = 0; i < 3; i += 1) seedReport(workspace.id);
    const events = queryLocalSql(
      `select kind::text as kind, facts::text as facts, workspace_name from public.platform_events where workspace_id = '${workspace.id}' order by id`,
      z.array(
        z.object({
          kind: z.string(),
          facts: z.string(),
          workspace_name: z.string(),
        }),
      ),
    );
    expect(events.map((event) => event.kind)).toEqual([
      "report",
      "report",
      "report",
      "auto_suspended",
    ]);
    expect(JSON.parse(events[3].facts)).toEqual({ reports: 3, people: 10 });
    expect(events[3].workspace_name).toBe("Suspension Club");
  });
});

describe("what a suspension does", () => {
  it("pauses the queue at reserve time and resumes it on lift", async () => {
    const { workspace } = await workspaceWithPeople(1);
    runLocalSql(
      `select private.open_suspension('${workspace.id}', 'platform_admin', null, '{}')`,
    );
    const job = queryLocalSql(
      `insert into public.outbox_jobs (kind, workspace_id, invitee_id, payload, idempotency_key, status, locked_until)
       select 'reminder', '${workspace.id}', i.id, '{}'::jsonb, 'r:' || gen_random_uuid(), 'processing', now() + interval '1 minute'
       from public.meeting_invitees i where i.workspace_id = '${workspace.id}' limit 1
       returning id::text as id`,
      z.array(z.object({ id: z.string() })).length(1),
    )[0];
    const { data } = await adminClient().rpc("dispatch_reserve", {
      p_job: job.id,
    });
    expect(data).toEqual({ kind: "gone" });
    const paused = queryLocalSql(
      `select status::text as status, last_error from public.outbox_jobs where id = '${job.id}'`,
      z
        .array(z.object({ status: z.string(), last_error: z.string() }))
        .length(1),
    )[0];
    expect(paused).toEqual({ status: "paused", last_error: "suspended" });
    runLocalSql(`select private.lift_suspension('${workspace.id}', null)`);
    const resumed = queryLocalSql(
      `select status::text as status from public.outbox_jobs where id = '${job.id}'`,
      z.array(z.object({ status: z.string() })).length(1),
    )[0];
    expect(resumed.status).toBe("pending");
  });

  it("refuses organizers' sends and nudges in plain words, but not members' answers", async () => {
    const { owner, workspace, meetingId } = await workspaceWithPeople(1);
    runLocalSql(
      `select private.open_suspension('${workspace.id}', 'platform_admin', null, '{}')`,
    );
    expect(
      (await owner.client.rpc("send_meeting", { p_meeting: meetingId })).error
        ?.message,
    ).toBe("tn:sending_suspended");
    expect(
      (await owner.client.rpc("nudge_meeting", { p_meeting: meetingId })).error
        ?.message,
    ).toBe("tn:sending_suspended");
  });

  it("refuses an edit that would email people, not one that emails no one", async () => {
    const { owner, workspace, meetingId } = await workspaceWithPeople(2);
    runLocalSql(
      `select private.open_suspension('${workspace.id}', 'platform_admin', null, '{}')`,
    );
    const edit = (
      fields: Record<string, string>,
      notify: boolean,
      dryRun: boolean,
    ) =>
      owner.client.rpc("edit_sent_meeting", {
        p_meeting: meetingId,
        p_fields: fields,
        p_notify: notify,
        p_dry_run: dryRun,
      });
    const preview = await edit({ location_text: "Room C3" }, true, true);
    expect(preview.error).toBeNull();
    expect((preview.data as { emails: number }).emails).toBeGreaterThan(0);
    expect(
      (await edit({ location_text: "Room C3" }, true, false)).error?.message,
    ).toBe("tn:sending_suspended");
    expect(
      (await edit({ title: "Weekly sync (moved)" }, false, false)).error,
    ).toBeNull();
  });

  it("never refuses a member's answer", async () => {
    const { workspace, meetingId } = await workspaceWithPeople(1);
    const { data: contact } = await adminClient()
      .from("contacts")
      .insert({
        workspace_id: workspace.id,
        email: `m-${crypto.randomUUID()}@example.test`,
        full_name: "Member",
      })
      .select("id")
      .single();
    const member = await seedInvitee(
      workspace.id,
      meetingId,
      contact?.id ?? "",
    );
    runLocalSql(
      `select private.open_suspension('${workspace.id}', 'platform_admin', null, '{}')`,
    );
    const { error } = await adminClient().rpc("token_submit_response", {
      p_token_hash: member.hash,
      p_status: "attending",
      p_delay_minutes: null,
      p_reason: null,
      p_comment: null,
    } as never);
    expect(error).toBeNull();
  });

  it("drops, after the lift, a paused email whose meeting has started meanwhile", async () => {
    const { owner, workspace, meetingId } = await workspaceWithPeople(1);
    // A connected Gmail sender: without one the reserve has nothing to send with ("gone").
    await setSender(workspace.id, (await seedConnection(owner.id)).id);
    const job = queryLocalSql(
      `insert into public.outbox_jobs (kind, workspace_id, invitee_id, payload, idempotency_key, status)
       select 'reminder', '${workspace.id}', i.id, '{"audience":"pending"}'::jsonb, 'r:' || gen_random_uuid(), 'pending'
       from public.meeting_invitees i where i.workspace_id = '${workspace.id}' limit 1
       returning id::text as id`,
      z.array(z.object({ id: z.string() })).length(1),
    )[0];
    runLocalSql(
      `select private.open_suspension('${workspace.id}', 'platform_admin', null, '{}')`,
    );
    runLocalSql(
      `update public.meetings set starts_at = now() - interval '1 minute' where id = '${meetingId}'`,
    );
    runLocalSql(`select private.lift_suspension('${workspace.id}', null)`);
    runLocalSql(
      `update public.outbox_jobs set status = 'processing', locked_until = now() + interval '1 minute' where id = '${job.id}'`,
    );
    const { data } = await adminClient().rpc("dispatch_reserve", {
      p_job: job.id,
    });
    expect(data).toEqual({ kind: "done" });
    const row = queryLocalSql(
      `select last_error from public.outbox_jobs where id = '${job.id}'`,
      z.array(z.object({ last_error: z.string() })).length(1),
    )[0];
    expect(row.last_error).toBe("meeting_started");
  });

  it("lets members of the workspace see that it is suspended, and no one else", async () => {
    const { owner, workspace } = await workspaceWithPeople(1);
    const stranger = await createTestUser();
    runLocalSql(
      `select private.open_suspension('${workspace.id}', 'platform_admin', null, '{}')`,
    );
    const mine = await owner.client
      .from("workspace_sending_suspensions")
      .select("workspace_id")
      .is("lifted_at", null);
    expect(mine.data).toHaveLength(1);
    const theirs = await stranger.client
      .from("workspace_sending_suspensions")
      .select("workspace_id");
    expect(theirs.data).toEqual([]);
  });
});

describe("admin suspend and lift", () => {
  it("only platform admins; a second suspend is a conflict; each action is logged with its actor", async () => {
    const { owner, workspace } = await workspaceWithPeople(1);
    const admin = await createTestUser();
    makePlatformAdmin(admin);
    expect(
      (await owner.client.rpc("admin_suspend", { p_workspace: workspace.id }))
        .error?.message,
    ).toBe("tn:not_found");
    expect(
      (await admin.client.rpc("admin_suspend", { p_workspace: workspace.id }))
        .error,
    ).toBeNull();
    expect(
      (await admin.client.rpc("admin_suspend", { p_workspace: workspace.id }))
        .error?.message,
    ).toBe("tn:conflict");
    expect(
      (await admin.client.rpc("admin_lift", { p_workspace: workspace.id }))
        .error,
    ).toBeNull();
    const kinds = queryLocalSql(
      `select kind::text as kind, actor_id::text as actor from public.platform_events where workspace_id = '${workspace.id}' and kind in ('suspended', 'lifted') order by id`,
      z.array(z.object({ kind: z.string(), actor: z.string() })),
    );
    expect(kinds).toEqual([
      { kind: "suspended", actor: admin.id },
      { kind: "lifted", actor: admin.id },
    ]);
  });
});

describe("platform events from the system", () => {
  it("notes the platform email cap once a day", async () => {
    runLocalSql(
      `delete from public.platform_events where kind = 'platform_email_cap'`,
    );
    await withLimit("invite_email_platform_per_day", 2, async () => {
      for (let i = 0; i < 3; i += 1) {
        runLocalSql(
          `select private.hit_rate_limit('invite_email:platform', 2, interval '24 hours')`,
        );
      }
    });
    expect(
      queryLocalSql(
        `select count(*)::int as n from public.platform_events where kind = 'platform_email_cap'`,
        count,
      )[0].n,
    ).toBe(1);
  });

  it("records a failing worker lane at most once an hour", async () => {
    runLocalSql(
      `delete from public.platform_events where kind = 'worker_failing'`,
    );
    await adminClient().rpc("record_worker_failure", { p_lane: "emails" });
    await adminClient().rpc("record_worker_failure", { p_lane: "emails" });
    await adminClient().rpc("record_worker_failure", { p_lane: "sheets" });
    expect(
      queryLocalSql(
        `select count(*)::int as n from public.platform_events where kind = 'worker_failing'`,
        count,
      )[0].n,
    ).toBe(2);
  });
});
