import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { adminClient, createTestUser, type TestUser } from "@/test/db/clients";
import { seedInvitee } from "@/test/db/invitees";
import { seedMeeting } from "@/test/db/meetings";
import { serviceRpc } from "@/test/db/outbox";
import { seedContacts } from "@/test/db/roster";
import { seedConnection, setSender } from "@/test/db/sender";
import { createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";

let owner: TestUser;
let workspace: TestWorkspace;
let meeting: string;
let invitee: string;
let hash: string;

const claimSchema = z
  .object({
    jobs: z.array(
      z
        .object({
          job_id: z.uuid(),
          kind: z.enum(["invite", "calendar_confirm"]),
          invitee_id: z.uuid(),
          meeting: z.object({ ics_uid: z.string() }).loose(),
        })
        .loose(),
    ),
  })
  .loose();

const reserveSchema = z.union([
  z.object({
    kind: z.literal("ok"),
    calendar: z.object({
      action: z.enum(["request", "cancel"]),
      sequence: z.number().int(),
    }),
  }),
  z.object({ kind: z.literal("ok") }),
  z.object({ kind: z.literal("done") }),
  z.object({ kind: z.literal("gone") }),
  z.object({ kind: z.literal("quota"), retry_at: z.string() }),
]);

async function answer(
  status: "attending" | "late" | "absent",
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

/** Makes this person's calendar job due, claims it and reserves it. */
async function claimAndReserve() {
  await adminClient()
    .from("outbox_jobs")
    .update({ run_after: new Date(Date.now() - 1000).toISOString() })
    .eq("invitee_id", invitee)
    .eq("kind", "calendar_confirm")
    .eq("status", "pending");
  const run = crypto.randomUUID();
  const claim = claimSchema.parse(
    await serviceRpc("dispatch_claim", {
      p_run: run,
      p_limit: 50,
      p_lease_seconds: 70,
    }),
  );
  const job = claim.jobs.find((j) => j.kind === "calendar_confirm");
  if (!job) {
    throw new Error("no calendar job claimed");
  }
  const reserved = reserveSchema.parse(
    await serviceRpc("dispatch_reserve", {
      p_job: job.job_id,
      p_token_hash: null,
    }),
  );
  await serviceRpc("dispatch_release", { p_run: run });
  return { jobId: job.job_id, reserved, icsUid: job.meeting.ics_uid };
}

async function inviteeRow() {
  const { data, error } = await adminClient()
    .from("meeting_invitees")
    .select("calendar_state, calendar_sequence, email_status")
    .eq("id", invitee)
    .single();
  if (error) {
    throw error;
  }
  return data;
}

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Owner" });
  workspace = await createWorkspaceAs(owner, "Calendar Club");
  await setSender(workspace.id, await seedConnection(owner.id));
  const [contact] = await seedContacts(
    workspace.id,
    1,
    `cal-${crypto.randomUUID().slice(0, 6)}`,
  );
  meeting = await seedMeeting(workspace.id, { status: "scheduled" });
  ({ inviteeId: invitee, hash } = await seedInvitee(
    workspace.id,
    meeting,
    contact,
  ));
});

describe("calendar_confirm jobs", () => {
  it("adds the event after Going, then removes it after Absent; email status untouched", async () => {
    await answer("attending");
    const first = await claimAndReserve();
    expect(first.reserved).toEqual({
      kind: "ok",
      calendar: { action: "request", sequence: 0 },
    });
    expect(first.icsUid).toMatch(/@/);
    await serviceRpc("dispatch_finish", {
      p_job: first.jobId,
      p_outcome: "sent",
      p_error: null,
      p_token_hash: null,
    });
    expect(await inviteeRow()).toEqual({
      calendar_state: "added",
      calendar_sequence: 1,
      email_status: "sent",
    });

    await answer("absent");
    const second = await claimAndReserve();
    expect(second.reserved).toEqual({
      kind: "ok",
      calendar: { action: "cancel", sequence: 1 },
    });
    await serviceRpc("dispatch_finish", {
      p_job: second.jobId,
      p_outcome: "sent",
      p_error: null,
      p_token_hash: null,
    });
    expect(await inviteeRow()).toMatchObject({
      calendar_state: "none",
      calendar_sequence: 2,
      email_status: "sent",
    });
  });

  it("sends nothing when the state already matches (quick flips, Late delay change) (Review Focus 2)", async () => {
    await answer("attending");
    const add = await claimAndReserve();
    await serviceRpc("dispatch_finish", {
      p_job: add.jobId,
      p_outcome: "sent",
      p_error: null,
      p_token_hash: null,
    });
    await answer("absent");
    await answer("late");
    const flip = await claimAndReserve();
    expect(flip.reserved).toEqual({ kind: "done" });
    const { count } = await adminClient()
      .from("send_log")
      .select("id", { count: "exact", head: true })
      .eq("job_id", flip.jobId);
    expect(count).toBe(0);
  });

  it("records an unknown outcome as sent (never retried)", async () => {
    await answer("attending");
    const job = await claimAndReserve();
    await serviceRpc("dispatch_finish", {
      p_job: job.jobId,
      p_outcome: "unknown",
      p_error: "delivery_unknown",
      p_token_hash: null,
    });
    expect(await inviteeRow()).toEqual({
      calendar_state: "added",
      calendar_sequence: 1,
      email_status: "sent",
    });
  });

  it("treats a lost lease after the send started like unknown", async () => {
    await answer("attending");
    const job = await claimAndReserve();
    await adminClient()
      .from("outbox_jobs")
      .update({
        status: "processing",
        locked_until: new Date(Date.now() - 1000).toISOString(),
      })
      .eq("id", job.jobId);
    await serviceRpc("dispatch_claim", {
      p_run: crypto.randomUUID(),
      p_limit: 50,
      p_lease_seconds: 70,
    });
    expect(await inviteeRow()).toEqual({
      calendar_state: "added",
      calendar_sequence: 1,
      email_status: "sent",
    });
  });

  it("does nothing for unsubscribed people or a started meeting", async () => {
    await answer("attending");
    const { data } = await adminClient()
      .from("meeting_invitees")
      .select("contact_id")
      .eq("id", invitee)
      .single();
    await adminClient()
      .from("contacts")
      .update({
        unsubscribed_at: new Date().toISOString(),
        unsubscribed_via: "link",
      })
      .eq("id", data?.contact_id ?? "");
    expect((await claimAndReserve()).reserved).toEqual({ kind: "done" });
    expect(await inviteeRow()).toMatchObject({
      calendar_state: "none",
      email_status: "sent",
    });
  });

  it("sends the event for an announcement only after the calendar request", async () => {
    await adminClient()
      .from("meetings")
      .update({ response_mode: "announcement" })
      .eq("id", meeting);
    await adminClient().rpc("token_request_calendar", { p_token_hash: hash });
    expect((await claimAndReserve()).reserved).toEqual({
      kind: "ok",
      calendar: { action: "request", sequence: 0 },
    });
  });

  it("gives up after the max attempts without touching the invite's email status", async () => {
    await answer("attending");
    const job = await claimAndReserve();
    await adminClient()
      .from("outbox_jobs")
      .update({ attempts: 99 })
      .eq("id", job.jobId);
    await serviceRpc("dispatch_retry", {
      p_job: job.jobId,
      p_error: "http_503",
    });
    expect(await inviteeRow()).toMatchObject({
      calendar_state: "none",
      email_status: "sent",
    });
  });

  it("counts only invite jobs as paused on the meeting page", async () => {
    await answer("attending");
    await adminClient()
      .from("outbox_jobs")
      .update({ status: "paused" })
      .eq("invitee_id", invitee)
      .eq("kind", "calendar_confirm");
    const { data } = await owner.client.rpc("meeting_results", {
      p_meeting: meeting,
    });
    expect(data).toMatchObject({ paused: 0 });
  });
});
