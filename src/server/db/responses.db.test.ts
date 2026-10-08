import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adminClient,
  anonClient,
  createTestUser,
  type TestUser,
} from "@/test/db/clients";
import { seedInvitee } from "@/test/db/invitees";
import { seedMeeting } from "@/test/db/meetings";
import { seedContacts } from "@/test/db/roster";
import {
  addMember,
  createWorkspaceAs,
  type TestWorkspace,
} from "@/test/db/workspaces";

let owner: TestUser;
let workspace: TestWorkspace;
let meeting: string;
let contact: string;
let invitee: string;
let hash: string;

const answerSchema = z.object({
  status: z.enum(["attending", "late", "absent", "not_attending"]),
  delay_minutes: z.number().int().nullable(),
  reason: z.string(),
  comment: z.string(),
  after_deadline: z.boolean(),
  responded_at: z.string(),
  updated_at: z.string(),
});

async function submit(
  args: Partial<{
    p_status: string;
    p_delay_minutes: number | null;
    p_reason: string | null;
    p_comment: string | null;
  }> & { p_token_hash?: string },
) {
  return adminClient().rpc("token_submit_response", {
    p_token_hash: hash,
    p_status: "attending",
    p_delay_minutes: null,
    p_reason: null,
    p_comment: null,
    ...args,
  } as never);
}

async function setMeeting(fields: Record<string, string | boolean | null>) {
  const { error } = await adminClient()
    .from("meetings")
    .update(fields as never)
    .eq("id", meeting);
  if (error) {
    throw error;
  }
}

async function calendarJobs() {
  const { data, error } = await adminClient()
    .from("outbox_jobs")
    .select("id, status, run_after, idempotency_key")
    .eq("invitee_id", invitee)
    .eq("kind", "calendar_confirm");
  if (error) {
    throw error;
  }
  return data;
}

async function historyCount() {
  const { count, error } = await adminClient()
    .from("response_history")
    .select("id", { count: "exact", head: true })
    .eq("invitee_id", invitee);
  if (error) {
    throw error;
  }
  return count ?? 0;
}

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Owner" });
  workspace = await createWorkspaceAs(owner, "Answer Club");
  [contact] = await seedContacts(
    workspace.id,
    1,
    `ans-${crypto.randomUUID().slice(0, 6)}`,
  );
  meeting = await seedMeeting(workspace.id, { status: "scheduled" });
  ({ inviteeId: invitee, hash } = await seedInvitee(
    workspace.id,
    meeting,
    contact,
  ));
});

describe("token_submit_response", () => {
  it("saves Going with no reason, writes history and queues one calendar job", async () => {
    const { data, error } = await submit({
      p_status: "attending",
      p_reason: "ignored",
    });
    expect(error).toBeNull();
    const answer = answerSchema.parse(data);
    expect(answer).toMatchObject({
      status: "attending",
      delay_minutes: null,
      reason: "",
      after_deadline: false,
    });
    expect(await historyCount()).toBe(1);
    const jobs = await calendarJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("pending");
    expect(new Date(jobs[0].run_after).getTime()).toBeGreaterThan(
      Date.now() + 30_000,
    );
  });

  it("returns null for an unknown token", async () => {
    const { data, error } = await submit({ p_token_hash: "f".repeat(64) });
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it("requires a delay from the meeting's options for Late", async () => {
    expect(
      (await submit({ p_status: "late", p_reason: "Bus" })).error?.message,
    ).toBe("tn:delay_required");
    expect(
      (await submit({ p_status: "late", p_delay_minutes: 7, p_reason: "Bus" }))
        .error?.message,
    ).toBe("tn:delay_required");
    const ok = await submit({
      p_status: "late",
      p_delay_minutes: 10,
      p_reason: "Bus",
    });
    expect(answerSchema.parse(ok.data)).toMatchObject({
      status: "late",
      delay_minutes: 10,
      reason: "Bus",
    });
  });

  it("requires a reason for Late and Absent when the meeting asks for one", async () => {
    expect(
      (await submit({ p_status: "absent", p_reason: "   " })).error?.message,
    ).toBe("tn:reason_required");
    await setMeeting({ reason_required: false });
    const ok = await submit({ p_status: "absent", p_reason: "  " });
    expect(answerSchema.parse(ok.data)).toMatchObject({
      status: "absent",
      reason: "",
    });
  });

  it("accepts only the choices of the meeting's mode", async () => {
    expect((await submit({ p_status: "not_attending" })).error?.message).toBe(
      "tn:invalid_choice",
    );
    await setMeeting({ response_mode: "rsvp" });
    expect(
      (await submit({ p_status: "late", p_delay_minutes: 10, p_reason: "x" }))
        .error?.message,
    ).toBe("tn:invalid_choice");
    expect(
      (await submit({ p_status: "not_attending", p_reason: "Exam" })).error,
    ).toBeNull();
    await setMeeting({ response_mode: "announcement" });
    expect((await submit({ p_status: "attending" })).error?.message).toBe(
      "tn:invalid_choice",
    );
  });

  it("keeps a comment only when the meeting allows comments", async () => {
    const off = await submit({ p_comment: "See you" });
    expect(answerSchema.parse(off.data).comment).toBe("");
    await setMeeting({ comments_enabled: true });
    const on = await submit({ p_comment: "  See you  " });
    expect(answerSchema.parse(on.data).comment).toBe("See you");
  });

  it("refuses reasons or comments over 500 characters", async () => {
    const { error } = await submit({
      p_status: "absent",
      p_reason: "x".repeat(501),
    });
    expect(error?.code).toBe("23514");
  });

  it("is closed once the meeting has started (Review Focus 3)", async () => {
    await setMeeting({ starts_at: new Date(Date.now() - 1000).toISOString() });
    expect((await submit({})).error?.message).toBe("tn:answers_closed");
  });

  it("is closed for a cancelled or draft meeting", async () => {
    await setMeeting({ status: "cancelled" });
    expect((await submit({})).error?.message).toBe("tn:answers_closed");
  });

  it("flags an answer saved after the deadline but still accepts it (Review Focus 3)", async () => {
    await setMeeting({
      response_deadline: new Date(Date.now() - 1000).toISOString(),
    });
    const late = await submit({ p_status: "attending" });
    expect(answerSchema.parse(late.data).after_deadline).toBe(true);
  });

  it("changes the answer in place, appends history, keeps one pending job", async () => {
    await submit({ p_status: "attending" });
    const first = (await calendarJobs())[0];
    await submit({ p_status: "absent", p_reason: "Sick" });
    const { data } = await adminClient()
      .from("responses")
      .select("status, responded_at, updated_at")
      .eq("invitee_id", invitee)
      .single();
    expect(data?.status).toBe("absent");
    expect(await historyCount()).toBe(2);
    const jobs = await calendarJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].id).toBe(first.id);
    expect(new Date(jobs[0].run_after).getTime()).toBeGreaterThanOrEqual(
      new Date(first.run_after).getTime(),
    );
  });

  it("ignores an identical re-save (no history row, no job change) (Review Focus 2)", async () => {
    await submit({ p_status: "late", p_delay_minutes: 10, p_reason: "Bus" });
    const before = await calendarJobs();
    await submit({ p_status: "late", p_delay_minutes: 10, p_reason: " Bus " });
    expect(await historyCount()).toBe(1);
    expect(await calendarJobs()).toEqual(before);
  });

  it("serializes concurrent saves: one answer row, one pending job (Review Focus 2)", async () => {
    const results = await Promise.all([
      submit({ p_status: "attending" }),
      submit({ p_status: "absent", p_reason: "Sick" }),
      submit({ p_status: "late", p_delay_minutes: 5, p_reason: "Bus" }),
    ]);
    expect(results.every((r) => r.error === null)).toBe(true);
    const { count } = await adminClient()
      .from("responses")
      .select("id", { count: "exact", head: true })
      .eq("invitee_id", invitee);
    expect(count).toBe(1);
    expect(await historyCount()).toBe(3);
    expect(
      (await calendarJobs()).filter((j) => j.status === "pending"),
    ).toHaveLength(1);
  });

  it("refreshes a paused calendar job instead of adding a second one", async () => {
    await submit({ p_status: "attending" });
    const [job] = await calendarJobs();
    await adminClient()
      .from("outbox_jobs")
      .update({ status: "paused" })
      .eq("id", job.id);
    await submit({ p_status: "absent", p_reason: "Sick" });
    const jobs = await calendarJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].status).toBe("paused");
  });
});

describe("token_request_calendar", () => {
  it("records the request for an announcement and queues a calendar job", async () => {
    await setMeeting({ response_mode: "announcement" });
    const { data, error } = await adminClient().rpc("token_request_calendar", {
      p_token_hash: hash,
    });
    expect(error).toBeNull();
    expect(data).toBe(true);
    const { data: row } = await adminClient()
      .from("meeting_invitees")
      .select("calendar_requested_at")
      .eq("id", invitee)
      .single();
    expect(row?.calendar_requested_at).not.toBeNull();
    expect(await calendarJobs()).toHaveLength(1);
  });

  it("is only for announcements, and closed after the start", async () => {
    expect(
      (
        await adminClient().rpc("token_request_calendar", {
          p_token_hash: hash,
        })
      ).error?.message,
    ).toBe("tn:invalid_choice");
    await setMeeting({
      response_mode: "announcement",
      starts_at: new Date(Date.now() - 1000).toISOString(),
    });
    expect(
      (
        await adminClient().rpc("token_request_calendar", {
          p_token_hash: hash,
        })
      ).error?.message,
    ).toBe("tn:answers_closed");
  });

  it("returns false for an unknown token", async () => {
    const { data } = await adminClient().rpc("token_request_calendar", {
      p_token_hash: "e".repeat(64),
    });
    expect(data).toBe(false);
  });
});

describe("token_invitee (M5 fields)", () => {
  it("returns the answer settings, the holder's name and the current answer", async () => {
    await submit({ p_status: "late", p_delay_minutes: 15, p_reason: "Bus" });
    const { data } = await adminClient().rpc("token_invitee", {
      p_token_hash: hash,
    });
    expect(data).toMatchObject({
      full_name: expect.any(String),
      calendar_requested: false,
      answers: {
        response_mode: "attendance",
        delay_options: [5, 10, 15, 30],
        reason_required: true,
        comments_enabled: false,
        footer_note: "",
        response_deadline: null,
      },
      answer: { status: "late", delay_minutes: 15, reason: "Bus" },
    });
  });
});

describe("responses RLS", () => {
  it("lets Owner, Admin and Viewer read answers; nobody writes; no cross-workspace reads", async () => {
    await submit({ p_status: "absent", p_reason: "Sick" });
    const admin = await createTestUser();
    const viewer = await createTestUser();
    const outsider = await createTestUser();
    await addMember(workspace.id, admin.id, "admin");
    await addMember(workspace.id, viewer.id, "viewer");
    await createWorkspaceAs(outsider, "Other Club");
    for (const member of [owner, admin, viewer]) {
      const { data } = await member.client
        .from("responses")
        .select("reason")
        .eq("invitee_id", invitee);
      expect(data).toEqual([{ reason: "Sick" }]);
      const history = await member.client
        .from("response_history")
        .select("id")
        .eq("invitee_id", invitee);
      expect(history.data).toHaveLength(1);
    }
    expect(
      (
        await outsider.client
          .from("responses")
          .select("id")
          .eq("invitee_id", invitee)
      ).data,
    ).toEqual([]);
    expect(
      (await anonClient().from("responses").select("id")).error?.code,
    ).toBe("42501");
    const write = await owner.client
      .from("responses")
      .update({ reason: "x" })
      .eq("invitee_id", invitee)
      .select("id");
    expect(write.error?.code).toBe("42501");
    const stored = await adminClient()
      .from("responses")
      .select("reason")
      .eq("invitee_id", invitee)
      .single();
    expect(stored.data?.reason).toBe("Sick");
    const insert = await owner.client
      .from("response_history")
      .insert({} as never);
    expect(insert.error).not.toBeNull();
  });

  it("does not let signed-in users call the token write functions", async () => {
    const { error } = await owner.client.rpc("token_submit_response", {
      p_token_hash: hash,
      p_status: "attending",
      p_delay_minutes: null,
      p_reason: null,
      p_comment: null,
    } as never);
    expect(error?.code).toBe("42501");
  });
});
