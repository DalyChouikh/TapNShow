import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Json } from "@/server/db/database.types";
import {
  adminClient,
  createTestUser,
  expectAppError,
  type TestUser,
} from "@/test/db/clients";
import { seedInvitee } from "@/test/db/invitees";
import { seedMeeting } from "@/test/db/meetings";
import { parkAllJobs, serviceRpc, timersOf } from "@/test/db/outbox";
import { seedContacts } from "@/test/db/roster";
import { seedConnection, setSender } from "@/test/db/sender";
import { queryLocalSql } from "@/test/db/sql";
import {
  addMember,
  createWorkspaceAs,
  type TestWorkspace,
} from "@/test/db/workspaces";

let owner: TestUser;
let workspace: TestWorkspace;
let connection: string;
let meeting: string;
let contacts: string[];
let a: { inviteeId: string; hash: string };
let b: { inviteeId: string; hash: string };

const claimSchema = z.object({
  jobs: z.array(
    z
      .object({
        job_id: z.uuid(),
        kind: z.enum([
          "invite",
          "calendar_confirm",
          "update",
          "cancel",
          "reminder",
        ]),
        invitee_id: z.uuid(),
        payload: z.record(z.string(), z.json()).optional(),
      })
      .loose(),
  ),
});

const reserveSchema = z.union([
  z.object({
    kind: z.literal("ok"),
    calendar: z.object({
      action: z.enum(["request", "cancel"]),
      sequence: z.number().int(),
    }),
    unsubscribed: z.literal(true).optional(),
  }),
  z.object({ kind: z.literal("ok") }),
  z.object({ kind: z.literal("done") }),
  z.object({ kind: z.literal("gone") }),
  z.object({ kind: z.literal("quota"), retry_at: z.string() }),
]);

const jobRowSchema = z.object({
  id: z.uuid(),
  status: z.string(),
  last_error: z.string().nullable(),
  payload: z.record(z.string(), z.json()),
  invitee_id: z.uuid().nullable(),
});

const hoursFromNow = (hours: number) =>
  new Date(Date.now() + hours * 3600_000).toISOString();
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

async function answer(
  who: { hash: string },
  status: "attending" | "late" | "absent",
) {
  const { error } = await adminClient().rpc("token_submit_response", {
    p_token_hash: who.hash,
    p_status: status,
    p_delay_minutes: status === "late" ? 10 : null,
    p_reason: status === "attending" ? null : "Reason",
    p_comment: null,
  } as never);
  if (error) {
    throw error;
  }
}

async function insertJob(
  kind: "update" | "cancel" | "reminder",
  inviteeId: string | null,
  payload: Record<string, Json>,
  runAfter = ago(1000),
) {
  const { data, error } = await adminClient()
    .from("outbox_jobs")
    .insert({
      kind,
      workspace_id: workspace.id,
      invitee_id: inviteeId,
      meeting_id: meeting,
      payload,
      idempotency_key: `${kind}:${inviteeId ?? "timer"}:${crypto.randomUUID()}`,
      run_after: runAfter,
    })
    .select("id")
    .single();
  if (error) {
    throw error;
  }
  return data.id;
}

async function jobRow(id: string) {
  const { data } = await adminClient()
    .from("outbox_jobs")
    .select("id, status, last_error, payload, invitee_id")
    .eq("id", id)
    .single();
  return jobRowSchema.parse(data);
}

/** Per-person reminder jobs of the meeting (not timers). */
async function remindersOf(meetingId = meeting) {
  const { data } = await adminClient()
    .from("outbox_jobs")
    .select("id, status, last_error, payload, invitee_id")
    .eq("meeting_id", meetingId)
    .eq("kind", "reminder")
    .not("invitee_id", "is", null);
  return z.array(jobRowSchema).parse(data);
}

async function claim(limit = 50) {
  const run = crypto.randomUUID();
  const data = await serviceRpc("dispatch_claim", {
    p_run: run,
    p_limit: limit,
    p_lease_seconds: 70,
  });
  return { run, claim: data ? claimSchema.parse(data) : null };
}

/** Claims everything due and reserves `jobId`; returns the reserve result and the job row. */
async function reserveOne(jobId: string) {
  const { run } = await claim();
  const reserved = reserveSchema.parse(
    await serviceRpc("dispatch_reserve", { p_job: jobId, p_token_hash: null }),
  );
  await serviceRpc("dispatch_release", { p_run: run });
  return { reserved, job: await jobRow(jobId) };
}

async function finish(jobId: string, outcome: "sent" | "skipped") {
  await serviceRpc("dispatch_finish", {
    p_job: jobId,
    p_outcome: outcome,
    p_error: null,
    p_token_hash: null,
  });
}

async function setInvitee(
  id: string,
  values: Record<string, string | number | boolean | null>,
) {
  const { error } = await adminClient()
    .from("meeting_invitees")
    .update(values as never)
    .eq("id", id);
  if (error) {
    throw error;
  }
}

async function invitee(id: string) {
  const { data } = await adminClient()
    .from("meeting_invitees")
    .select("calendar_state, calendar_sequence, email_status")
    .eq("id", id)
    .single();
  return data;
}

const sendLogRows = (jobId: string) =>
  queryLocalSql(
    `select count(*)::int as n from public.send_log where job_id = '${jobId}'`,
    z.array(z.object({ n: z.number() })),
  )[0].n;

beforeEach(async () => {
  // Claims are global: park what other files left so the claims below see only this test's jobs.
  parkAllJobs();
  owner = await createTestUser({ fullName: "Owner" });
  workspace = await createWorkspaceAs(owner, "Reminder Club");
  connection = await seedConnection(owner.id);
  await setSender(workspace.id, connection);
  contacts = await seedContacts(
    workspace.id,
    3,
    `m6d-${crypto.randomUUID().slice(0, 6)}`,
  );
  meeting = await seedMeeting(workspace.id, { status: "scheduled" });
  a = await seedInvitee(workspace.id, meeting, contacts[0]);
  b = await seedInvitee(workspace.id, meeting, contacts[1]);
});

describe("reminder timers fan out", () => {
  it("queues only the eligible people for each audience", async () => {
    await answer(a, "attending");
    const pending = await insertJob("reminder", null, { audience: "pending" });
    await claim();
    expect((await jobRow(pending)).status).toBe("done");
    let reminders = await remindersOf();
    expect(reminders.map((r) => [r.invitee_id, r.payload.audience])).toEqual([
      [b.inviteeId, "pending"],
    ]);
    await insertJob("reminder", null, { audience: "going" });
    await claim();
    reminders = await remindersOf();
    expect(
      reminders
        .filter((r) => r.payload.audience === "going")
        .map((r) => r.invitee_id),
    ).toEqual([a.inviteeId]);
  });

  it("counts a person still to reconfirm as not answered", async () => {
    await answer(a, "attending");
    await adminClient()
      .from("responses")
      .update({ needs_reconfirmation: true })
      .eq("invitee_id", a.inviteeId);
    await insertJob("reminder", null, { audience: "pending" });
    await insertJob("reminder", null, { audience: "going" });
    await claim();
    const reminders = await remindersOf();
    expect(reminders.map((r) => r.payload.audience)).toEqual([
      "pending",
      "pending",
    ]);
    expect(reminders.map((r) => r.invitee_id).sort()).toEqual(
      [a.inviteeId, b.inviteeId].sort(),
    );
  });

  it("skips unsubscribed people, failed invites, and meetings that started", async () => {
    const c = await seedInvitee(workspace.id, meeting, contacts[2], {
      emailStatus: "failed",
    });
    const unsubscribe = await adminClient()
      .from("contacts")
      .update({
        unsubscribed_at: new Date().toISOString(),
        unsubscribed_via: "link",
      })
      .eq("id", contacts[1]);
    expect(unsubscribe.error).toBeNull();
    await insertJob("reminder", null, { audience: "pending" });
    await claim();
    expect((await remindersOf()).map((r) => r.invitee_id)).toEqual([
      a.inviteeId,
    ]);
    expect(c.inviteeId).toBeTruthy();
    const started = await seedMeeting(workspace.id, { status: "scheduled" });
    await seedInvitee(workspace.id, started, contacts[0]);
    await adminClient()
      .from("meetings")
      .update({ starts_at: ago(60_000) })
      .eq("id", started);
    meeting = started;
    await insertJob("reminder", null, { audience: "pending" });
    await claim();
    expect(await remindersOf(started)).toEqual([]);
  });

  it("never claims a timer as a sendable job", async () => {
    const timer = await insertJob(
      "reminder",
      null,
      { audience: "pending" },
      hoursFromNow(1),
    );
    const { claim: claimed } = await claim();
    expect(claimed).toBeNull();
    expect((await jobRow(timer)).status).toBe("pending");
  });

  it("fans a due timer out even without a sender; only the reminders wait (paused)", async () => {
    await setSender(workspace.id, null);
    const timer = await insertJob("reminder", null, { audience: "pending" });
    await claim();
    expect((await jobRow(timer)).status).toBe("done");
    expect((await remindersOf()).map((r) => r.status)).toEqual([
      "paused",
      "paused",
    ]);
  });

  it("keeps future timers in place when the sender is held back or reconnected (review)", async () => {
    const due = hoursFromNow(72);
    const timer = await insertJob(
      "reminder",
      null,
      { audience: "pending" },
      due,
    );
    const same = async () => {
      const { data } = await adminClient()
        .from("outbox_jobs")
        .select("status, run_after")
        .eq("id", timer)
        .single();
      expect(data?.status).toBe("pending");
      expect(new Date(data?.run_after ?? "").getTime()).toBe(
        new Date(due).getTime(),
      );
    };
    await serviceRpc("dispatch_defer_sender", {
      p_run: crypto.randomUUID(),
      p_connection: connection,
      p_until: hoursFromNow(0.1),
      p_error: "gmail_throttled",
    });
    await same();
    await serviceRpc("dispatch_mark_broken", {
      p_run: crypto.randomUUID(),
      p_connection: connection,
      p_reason: "invalid_grant",
    });
    await same();
    await adminClient()
      .from("google_connections")
      .update({ status: "active" })
      .eq("id", connection);
    await same();
  });

  it("never queues a second reminder for someone who already has one waiting (review)", async () => {
    await answer(a, "attending");
    await insertJob("reminder", b.inviteeId, { audience: "pending" });
    await expectAppError(
      owner.client.rpc("nudge_meeting", { p_meeting: meeting }),
      "nothing_to_send",
    );
    await insertJob("reminder", null, { audience: "pending" });
    await claim();
    expect(
      (await remindersOf()).filter((r) => r.invitee_id === b.inviteeId),
    ).toHaveLength(1);
  });
});

describe("dispatch_reserve for M6 kinds", () => {
  it("re-checks reminder eligibility at send time", async () => {
    const job = await insertJob("reminder", b.inviteeId, {
      audience: "pending",
    });
    await answer(b, "attending");
    const { reserved, job: row } = await reserveOne(job);
    expect(reserved).toEqual({ kind: "done" });
    expect(row.last_error).toBe("not_eligible");
    expect(sendLogRows(job)).toBe(0);
  });

  it("drops a reminder still waiting when the meeting starts (Review Focus 5)", async () => {
    const job = await insertJob("reminder", b.inviteeId, {
      audience: "pending",
    });
    await adminClient()
      .from("meetings")
      .update({ starts_at: ago(60_000) })
      .eq("id", meeting);
    const { reserved, job: row } = await reserveOne(job);
    expect(reserved).toEqual({ kind: "done" });
    expect(row.last_error).toBe("meeting_started");
  });

  it("puts the calendar request inside an update for a calendar holder", async () => {
    await answer(a, "attending");
    await setInvitee(a.inviteeId, {
      calendar_state: "added",
      calendar_sequence: 1,
    });
    const job = await insertJob("update", a.inviteeId, {
      changes: { title: ["Old", "New"] },
      notify: true,
      reconfirm: false,
    });
    const { reserved } = await reserveOne(job);
    expect(reserved).toEqual({
      kind: "ok",
      calendar: { action: "request", sequence: 1 },
    });
    // "unknown" would mark an invite "Delivery unknown"; an update must leave the invite alone.
    await serviceRpc("dispatch_finish", {
      p_job: job,
      p_outcome: "unknown",
      p_error: "delivery_unknown",
      p_token_hash: null,
    });
    expect(await invitee(a.inviteeId)).toEqual({
      calendar_state: "added",
      calendar_sequence: 2,
      email_status: "sent",
    });
  });

  it("finishes an update with nothing to say unsent (Review Focus 1)", async () => {
    const empty = await insertJob("update", b.inviteeId, {
      changes: {},
      notify: true,
      reconfirm: false,
    });
    let result = await reserveOne(empty);
    expect(result.reserved).toEqual({ kind: "done" });
    expect(result.job.last_error).toBe("nothing_to_send");
    const quiet = await insertJob("update", b.inviteeId, {
      changes: { title: ["a", "b"] },
      notify: false,
      reconfirm: false,
    });
    result = await reserveOne(quiet);
    expect(result.reserved).toEqual({ kind: "done" });
    expect(result.job.last_error).toBe("nothing_to_send");
    const confirm = await insertJob("update", b.inviteeId, {
      changes: {},
      notify: true,
      reconfirm: true,
    });
    result = await reserveOne(confirm);
    expect(result.reserved).toEqual({ kind: "ok" });
  });

  it("sends a calendar holder nothing when the changes cancelled out (review)", async () => {
    await answer(a, "attending");
    await setInvitee(a.inviteeId, {
      calendar_state: "added",
      calendar_sequence: 1,
    });
    const job = await insertJob("update", a.inviteeId, {
      changes: {},
      notify: false,
      reconfirm: false,
    });
    const { reserved, job: row } = await reserveOne(job);
    expect(reserved).toEqual({ kind: "done" });
    expect(row.last_error).toBe("nothing_to_send");
  });

  it("forgets an earlier calendar decision when a retry decides none", async () => {
    await answer(a, "attending");
    await setInvitee(a.inviteeId, {
      calendar_state: "added",
      calendar_sequence: 1,
    });
    const job = await insertJob("update", a.inviteeId, {
      changes: { title: ["Old", "New"] },
      notify: true,
      reconfirm: false,
    });
    await reserveOne(job);
    await serviceRpc("dispatch_retry", { p_job: job, p_error: "http_500" });
    await answer(a, "absent");
    await adminClient()
      .from("outbox_jobs")
      .update({ run_after: ago(1000) })
      .eq("id", job);
    const { reserved, job: row } = await reserveOne(job);
    expect(reserved).toEqual({ kind: "ok" });
    expect(row.payload.action).toBeUndefined();
    await finish(job, "sent");
    expect((await invitee(a.inviteeId))?.calendar_sequence).toBe(1);
  });

  it("frees the quota slot of a job the dispatcher skipped after reserving", async () => {
    const job = await insertJob("update", b.inviteeId, {
      changes: { title: ["a", "b"] },
      notify: true,
      reconfirm: false,
    });
    await reserveOne(job);
    expect(sendLogRows(job)).toBe(1);
    await finish(job, "skipped");
    expect(sendLogRows(job)).toBe(0);
  });

  it("sends a cancellation only for a cancelled meeting, removing the event", async () => {
    await setInvitee(a.inviteeId, {
      calendar_state: "added",
      calendar_sequence: 2,
    });
    const early = await insertJob("cancel", a.inviteeId, {});
    const first = await reserveOne(early);
    expect(first.reserved).toEqual({ kind: "done" });
    expect(first.job.last_error).toBe("not_cancelled");
    await adminClient()
      .from("meetings")
      .update({ status: "cancelled" })
      .eq("id", meeting);
    const holder = await insertJob("cancel", a.inviteeId, {});
    const { reserved } = await reserveOne(holder);
    expect(reserved).toEqual({
      kind: "ok",
      calendar: { action: "cancel", sequence: 2 },
    });
    await finish(holder, "sent");
    expect((await invitee(a.inviteeId))?.calendar_state).toBe("none");
    const other = await insertJob("cancel", b.inviteeId, {});
    expect((await reserveOne(other)).reserved).toEqual({ kind: "ok" });
  });

  it("removes the event of someone who unsubscribed, and sends them nothing else (owner decision)", async () => {
    await adminClient()
      .from("meetings")
      .update({ status: "cancelled" })
      .eq("id", meeting);
    await setInvitee(a.inviteeId, {
      calendar_state: "added",
      calendar_sequence: 2,
    });
    const { error } = await adminClient()
      .from("contacts")
      .update({
        unsubscribed_at: new Date().toISOString(),
        unsubscribed_via: "link",
      })
      .in("id", [contacts[0], contacts[1]]);
    expect(error).toBeNull();
    const holder = await insertJob("cancel", a.inviteeId, {});
    expect((await reserveOne(holder)).reserved).toEqual({
      kind: "ok",
      calendar: { action: "cancel", sequence: 2 },
      unsubscribed: true,
    });
    const other = await insertJob("cancel", b.inviteeId, {});
    const result = await reserveOne(other);
    expect(result.reserved).toEqual({ kind: "done" });
    expect(result.job.last_error).toBe("unsubscribed");
    const update = await insertJob("update", a.inviteeId, {
      changes: { title: ["Old", "New"] },
      notify: true,
      reconfirm: false,
    });
    expect((await reserveOne(update)).job.last_error).toBe("unsubscribed");
  });

  it("records the calendar decision of an update whose lease expired after the send started", async () => {
    await answer(a, "attending");
    await setInvitee(a.inviteeId, {
      calendar_state: "added",
      calendar_sequence: 1,
    });
    const job = await insertJob("update", a.inviteeId, {
      changes: { title: ["Old", "New"] },
      notify: true,
      reconfirm: false,
    });
    const { run } = await claim();
    await serviceRpc("dispatch_reserve", { p_job: job, p_token_hash: null });
    await serviceRpc("dispatch_release", { p_run: run });
    await adminClient()
      .from("outbox_jobs")
      .update({ status: "processing", locked_until: ago(1000) })
      .eq("id", job);
    await claim();
    const row = await jobRow(job);
    expect([row.status, row.last_error]).toEqual([
      "failed",
      "delivery_unknown",
    ]);
    expect((await invitee(a.inviteeId))?.calendar_sequence).toBe(2);
  });
});

describe("nudge_meeting", () => {
  const nudge = (client = owner.client, id = meeting) =>
    client.rpc("nudge_meeting", { p_meeting: id });

  it("queues one reminder per person who hasn't answered, then waits 12 h", async () => {
    await answer(a, "attending");
    const first = await nudge();
    expect(first.error).toBeNull();
    const result = z
      .object({ reminded: z.number(), next_at: z.string() })
      .parse(first.data);
    expect(result.reminded).toBe(1);
    expect(
      Math.abs(
        new Date(result.next_at).getTime() - (Date.now() + 12 * 3600_000),
      ),
    ).toBeLessThan(60_000);
    expect((await remindersOf()).map((r) => r.invitee_id)).toEqual([
      b.inviteeId,
    ]);
    await expectAppError(nudge(), "nudge_too_soon");
    // 12 h later (limits must be positive, so move the last nudge back instead), once the first
    // reminder went out.
    await adminClient()
      .from("outbox_jobs")
      .update({ status: "done" })
      .eq("meeting_id", meeting)
      .eq("kind", "reminder");
    await adminClient()
      .from("meetings")
      .update({ last_nudged_at: ago(12 * 3600_000 + 60_000) })
      .eq("id", meeting);
    expect((await nudge()).error).toBeNull();
  });

  it("refuses Viewers, announcements, started or cancelled meetings, and nobody to remind", async () => {
    const viewer = await createTestUser();
    await addMember(workspace.id, viewer.id, "viewer");
    await expectAppError(nudge(viewer.client), "forbidden");
    const announcement = await seedMeeting(workspace.id, {
      status: "scheduled",
      response_mode: "announcement",
    });
    await expectAppError(nudge(owner.client, announcement), "invalid_input");
    await answer(a, "attending");
    await answer(b, "absent");
    await expectAppError(nudge(), "nothing_to_send");
    const started = await seedMeeting(workspace.id, { status: "scheduled" });
    await adminClient()
      .from("meetings")
      .update({ starts_at: ago(60_000) })
      .eq("id", started);
    await expectAppError(nudge(owner.client, started), "meeting_started");
    const cancelled = await seedMeeting(workspace.id, { status: "cancelled" });
    await expectAppError(nudge(owner.client, cancelled), "meeting_cancelled");
  });

  it("asks for a connected Gmail first (Review Focus 4)", async () => {
    await adminClient()
      .from("google_connections")
      .update({ status: "broken" })
      .eq("id", connection);
    await expectAppError(nudge(), "sender_broken");
    await setSender(workspace.id, null);
    await expectAppError(nudge(), "sender_not_connected");
  });
});

describe("send_meeting timers", () => {
  let contact: string;

  async function sendTo(id: string, contactIds: string[]) {
    const audience = await owner.client.rpc("set_meeting_audience", {
      p_meeting: id,
      p_list_ids: [],
      p_include: contactIds,
      p_exclude: [],
    });
    if (audience.error) {
      throw audience.error;
    }
    return owner.client.rpc("send_meeting", { p_meeting: id });
  }

  beforeEach(() => {
    contact = contacts[2];
  });

  it("creates the two reminder timers at the first send, at the right times", async () => {
    const start = hoursFromNow(72);
    const deadline = hoursFromNow(48);
    const id = await seedMeeting(workspace.id, {
      starts_at: start,
      response_deadline: deadline,
      reminder_pending_hours: 24,
      reminder_going_hours: 2,
    });
    expect((await sendTo(id, [contact])).error).toBeNull();
    const timers = await timersOf(id);
    const at = (audience: string) =>
      timers.find((t) => t.payload.audience === audience)?.run_after;
    expect(new Date(at("pending") ?? "").getTime()).toBe(
      new Date(deadline).getTime() - 24 * 3600_000,
    );
    expect(new Date(at("going") ?? "").getTime()).toBe(
      new Date(start).getTime() - 2 * 3600_000,
    );
  });

  it("creates no timer whose time has already passed (sent 90 minutes before the start)", async () => {
    const id = await seedMeeting(workspace.id, {
      starts_at: hoursFromNow(1.5),
      reminder_pending_hours: 24,
      reminder_going_hours: 2,
    });
    expect((await sendTo(id, [contact])).error).toBeNull();
    expect(await timersOf(id)).toEqual([]);
  });

  it("creates no timer for an announcement or with reminders off", async () => {
    const off = await seedMeeting(workspace.id, {
      starts_at: hoursFromNow(72),
    });
    const announcement = await seedMeeting(workspace.id, {
      starts_at: hoursFromNow(72),
      response_mode: "announcement",
      reminder_pending_hours: 24,
      reminder_going_hours: 2,
    });
    expect((await sendTo(off, [contact])).error).toBeNull();
    expect((await sendTo(announcement, [contact])).error).toBeNull();
    expect(await timersOf(off)).toEqual([]);
    expect(await timersOf(announcement)).toEqual([]);
  });

  it("does not add timers again on Invite more", async () => {
    const id = await seedMeeting(workspace.id, {
      starts_at: hoursFromNow(72),
      reminder_pending_hours: 24,
    });
    expect((await sendTo(id, [contact])).error).toBeNull();
    // The timer fired; Invite more must not create a new one (only the first send does).
    const [timer] = await timersOf(id);
    await adminClient()
      .from("outbox_jobs")
      .update({ status: "done" })
      .eq("id", timer.id);
    const [later] = await seedContacts(
      workspace.id,
      1,
      `more-${crypto.randomUUID().slice(0, 6)}`,
    );
    expect((await sendTo(id, [contact, later])).error).toBeNull();
    expect(await timersOf(id)).toEqual([]);
  });
});
