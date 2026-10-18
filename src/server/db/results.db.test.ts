import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adminClient,
  createTestUser,
  expectAppError,
  type TestUser,
} from "@/test/db/clients";
import { seedInvitee } from "@/test/db/invitees";
import { seedMeeting } from "@/test/db/meetings";
import { explainCall, planUsesIndex } from "@/test/db/plans";
import { seedContacts } from "@/test/db/roster";
import { runLocalSql } from "@/test/db/sql";
import {
  addMember,
  createWorkspaceAs,
  type TestWorkspace,
} from "@/test/db/workspaces";

let owner: TestUser;
let viewer: TestUser;
let outsider: TestUser;
let workspace: TestWorkspace;
let past: string;
let contacts: string[];
const hashes: string[] = [];

const ago = (hours: number) =>
  new Date(Date.now() - hours * 3600_000).toISOString();

async function answer(
  hash: string,
  status: string,
  extra: Record<string, string | number> = {},
) {
  const { error } = await adminClient().rpc("token_submit_response", {
    p_token_hash: hash,
    p_status: status,
    p_delay_minutes: status === "late" ? 10 : null,
    p_reason: status === "attending" ? null : "Reason",
    p_comment: null,
    ...extra,
  } as never);
  if (error) {
    throw error;
  }
}

beforeAll(async () => {
  owner = await createTestUser({ fullName: "Owner" });
  viewer = await createTestUser();
  outsider = await createTestUser();
  workspace = await createWorkspaceAs(owner, "Results Club");
  await addMember(workspace.id, viewer.id, "viewer");
  contacts = await seedContacts(
    workspace.id,
    6,
    `res-${crypto.randomUUID().slice(0, 6)}`,
  );
  // Answers are written while the meeting is upcoming, then it is moved into the past.
  past = await seedMeeting(workspace.id, {
    status: "scheduled",
    title: "Last week",
  });
  for (const [n, contact] of contacts.entries()) {
    const emailStatus = n === 5 ? "failed" : "sent";
    hashes.push(
      (await seedInvitee(workspace.id, past, contact, { emailStatus })).hash,
    );
  }
  await answer(hashes[0], "attending");
  await answer(hashes[1], "late");
  await answer(hashes[2], "absent");
  await adminClient()
    .from("meetings")
    .update({ starts_at: ago(24 * 7) })
    .eq("id", past);
});

describe("meeting_results", () => {
  it("counts emails and answers; no reply excludes undelivered emails", async () => {
    const { data, error } = await viewer.client.rpc("meeting_results", {
      p_meeting: past,
    } as never);
    expect(error).toBeNull();
    expect(data).toMatchObject({
      response_mode: "attendance",
      emails: { total: 6, sent: 5, failed: 1 },
      answers: {
        attending: 1,
        late: 1,
        absent: 1,
        not_attending: 0,
        no_reply: 2,
        calendar_requested: 0,
      },
      paused: 0,
    });
  });

  it("is not found for non-members", async () => {
    await expectAppError(
      outsider.client.rpc("meeting_results", { p_meeting: past } as never),
      "not_found",
    );
  });
});

describe("meeting_people", () => {
  const pageSchema = z.object({
    has_more: z.boolean(),
    items: z.array(
      z
        .object({
          invitee_id: z.uuid(),
          sort_name: z.string(),
          answer: z
            .object({ status: z.string(), reason: z.string() })
            .nullable(),
        })
        .loose(),
    ),
  });
  const call = async (
    filter: string,
    after: { name: string; id: string } | null,
    limit: number,
  ) =>
    pageSchema.parse(
      (
        await owner.client.rpc("meeting_people", {
          p_meeting: past,
          p_filter: filter,
          p_after_name: after?.name ?? null,
          p_after_id: after?.id ?? null,
          p_limit: limit,
        } as never)
      ).data,
    );

  it("filters by answer, no reply and not delivered", async () => {
    expect(
      (await call("late", null, 50)).items.map((r) => r.answer?.status),
    ).toEqual(["late"]);
    expect((await call("no_reply", null, 50)).items).toHaveLength(2);
    expect((await call("not_delivered", null, 50)).items).toHaveLength(1);
  });

  it("pages without duplicates when names are equal and rows arrive between pages (Review Focus 5)", async () => {
    await adminClient()
      .from("contacts")
      .update({ full_name: "Same Name" })
      .in("id", contacts);
    const first = await call("all", null, 4);
    const last = first.items[3];
    // Named to sort after the cursor ("zed" > "same name"), so it must show up on page 2.
    const extra = await seedContacts(
      workspace.id,
      1,
      `zed-${crypto.randomUUID().slice(0, 6)}`,
    );
    await seedInvitee(workspace.id, past, extra[0]);
    const second = await call(
      "all",
      { name: last.sort_name, id: last.invitee_id },
      50,
    );
    const ids = [...first.items, ...second.items].map((r) => r.invitee_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(7);
  });
});

describe("contact_history", () => {
  it("counts only started meetings that asked for answers, in the period, newest first", async () => {
    const upcoming = await seedMeeting(workspace.id, { status: "scheduled" });
    await seedInvitee(workspace.id, upcoming, contacts[1]);
    const announcement = await seedMeeting(workspace.id, {
      status: "scheduled",
    });
    await adminClient()
      .from("meetings")
      .update({ response_mode: "announcement", starts_at: ago(1) })
      .eq("id", announcement);
    await seedInvitee(workspace.id, announcement, contacts[1]);
    const { data } = await viewer.client.rpc("contact_history", {
      p_contact: contacts[1],
      p_from: null,
      p_to: null,
      p_after_starts: null,
      p_after_meeting: null,
      p_limit: 50,
    } as never);
    expect(data).toMatchObject({
      counts: { attending: 0, late: 1, absent: 0, no_reply: 0 },
      has_more: false,
    });
    expect(
      z.object({ items: z.array(z.object({}).loose()) }).parse(data).items,
    ).toHaveLength(1);
    const outside = await viewer.client.rpc("contact_history", {
      p_contact: contacts[1],
      p_from: ago(24),
      p_to: null,
      p_after_starts: null,
      p_after_meeting: null,
      p_limit: 50,
    } as never);
    expect(outside.data).toMatchObject({ counts: { late: 0 }, items: [] });
  });
});

describe("attendance_summary and attendance_details", () => {
  it("summarizes every roster contact, zeros included; no reply leaves out undelivered invites", async () => {
    const { data } = await viewer.client.rpc("attendance_summary", {
      p_workspace: workspace.id,
      p_from: null,
      p_to: null,
    } as never);
    const parsed = z
      .object({
        meetings: z.number(),
        rows: z.array(
          z
            .object({
              contact_id: z.uuid(),
              invited: z.number(),
              attending: z.number(),
              late: z.number(),
              absent: z.number(),
              no_reply: z.number(),
            })
            .loose(),
        ),
      })
      .parse(data);
    const row = (contact: string) =>
      parsed.rows.find((r) => r.contact_id === contact);
    expect(parsed.meetings).toBeGreaterThanOrEqual(1);
    const none = { attending: 0, late: 0, absent: 0, no_reply: 0 };
    expect(row(contacts[0])).toMatchObject({
      ...none,
      invited: 1,
      attending: 1,
    });
    expect(row(contacts[1])).toMatchObject({ ...none, invited: 1, late: 1 });
    expect(row(contacts[2])).toMatchObject({ ...none, invited: 1, absent: 1 });
    expect(row(contacts[4])).toMatchObject({
      ...none,
      invited: 1,
      no_reply: 1,
    });
    // contacts[5]'s invite failed: invited, but never counted as not answering.
    expect(row(contacts[5])).toMatchObject({ ...none, invited: 1 });
  });

  it("lists one row per person per counted meeting, in pages", async () => {
    const { data } = await viewer.client.rpc("attendance_details", {
      p_workspace: workspace.id,
      p_from: null,
      p_to: null,
      p_after_starts: null,
      p_after_meeting: null,
      p_after_name: null,
      p_after_invitee: null,
      p_limit: 3,
    } as never);
    expect(data).toMatchObject({ has_more: true });
  });

  it("is forbidden to non-members", async () => {
    await expectAppError(
      outsider.client.rpc("attendance_summary", {
        p_workspace: workspace.id,
        p_from: null,
        p_to: null,
      } as never),
      "forbidden",
    );
  });
});

describe("query plans (fresh and stale statistics)", () => {
  /** A meeting with 1,000 invitees: the workspace-sized table every plan here is read against. */
  let busy: string;

  /**
   * Invites `count` new contacts to a new meeting in one bulk insert (PostgREST sends every key)
   * and returns the meeting.
   */
  async function bulkInvite(count: number): Promise<string> {
    const bulk = await seedContacts(
      workspace.id,
      count,
      `res-bulk-${crypto.randomUUID().slice(0, 6)}`,
    );
    const meetingId = await seedMeeting(workspace.id, { status: "scheduled" });
    const { error } = await adminClient()
      .from("meeting_invitees")
      .insert(
        bulk.map((contact) => ({
          workspace_id: workspace.id,
          meeting_id: meetingId,
          contact_id: contact,
          email_status: "sent" as const,
        })),
      );
    expect(error).toBeNull();
    return meetingId;
  }

  beforeAll(async () => {
    // A fresh database (CI) holds a handful of invitees, where a sequential scan is the right
    // plan; seed a workspace-sized table first so the plans reflect real use.
    busy = await bulkInvite(1000);
    runLocalSql(
      "analyze public.meeting_invitees, public.responses, public.meetings",
    );
  }, 60_000);

  /**
   * True when the plan reads a meeting's invitees through an index that leads with `meeting_id`
   * (with stale statistics the planner may pick the unique `(meeting_id, contact_id)` key; both
   * are fine) and never scans the whole invitees table.
   */
  function usesMeetingIndex(plan: string): boolean {
    return (
      !/Seq Scan on meeting_invitees\b/.test(plan) &&
      (planUsesIndex(plan, "meeting_invitees_meeting_ws_idx") ||
        planUsesIndex(plan, "meeting_invitees_meeting_id_contact_id_key"))
    );
  }

  it("uses the meeting and contact indexes, also right after a bulk insert without analyze", async () => {
    const fresh = explainCall(
      `public.meeting_people('${past}', 'all', null, null, 50)`,
      owner.id,
    );
    expect(usesMeetingIndex(fresh)).toBe(true);
    await bulkInvite(400);
    const stale = explainCall(
      `public.meeting_people('${past}', 'all', null, null, 50)`,
      owner.id,
    );
    expect(usesMeetingIndex(stale)).toBe(true);
    const history = explainCall(
      `public.contact_history('${contacts[0]}', null, null, null, null, 50)`,
      owner.id,
    );
    expect(planUsesIndex(history, "meeting_invitees_contact_ws_idx")).toBe(
      true,
    );
  });

  it("reads only due reminder timers, and holds updates by the invitee key (#255)", () => {
    // 500 per-person reminders waiting for later, and 3 due timers.
    runLocalSql(
      `insert into public.outbox_jobs (kind, workspace_id, meeting_id, invitee_id, payload, idempotency_key, run_after)
       select 'reminder', i.workspace_id, i.meeting_id, i.id, '{"audience":"pending"}', 'plan-' || i.id,
         now() + interval '1 day'
       from public.meeting_invitees i where i.meeting_id = '${busy}' limit 500`,
    );
    runLocalSql(
      `insert into public.outbox_jobs (kind, workspace_id, meeting_id, payload, idempotency_key, run_after)
       select 'reminder', '${workspace.id}', '${busy}', '{"audience":"pending"}', 'plan-timer-' || n,
         now() - interval '1 minute'
       from generate_series(1, 3) n`,
    );
    try {
      runLocalSql("analyze public.outbox_jobs");
      const plan = explainCall(
        `public.dispatch_claim('${crypto.randomUUID()}', 1, 60)`,
        owner.id,
        "service_role",
      );
      expect(planUsesIndex(plan, "outbox_jobs_due_timers_idx")).toBe(true);
      // private.job_held probes one invitee by id (inlined or not), never the whole table.
      expect(/Seq Scan on meeting_invitees\b/.test(plan)).toBe(false);
      expect(planUsesIndex(plan, "meeting_invitees_pkey")).toBe(true);
    } finally {
      runLocalSql(
        `delete from public.outbox_jobs where idempotency_key like 'plan-%' and meeting_id = '${busy}'`,
      );
    }
  });
});
