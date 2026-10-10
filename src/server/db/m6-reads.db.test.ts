import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { adminClient, createTestUser, type TestUser } from "@/test/db/clients";
import { seedInvitee } from "@/test/db/invitees";
import { seedMeeting } from "@/test/db/meetings";
import { parkAllJobs } from "@/test/db/outbox";
import { seedContacts } from "@/test/db/roster";
import { seedConnection, setSender } from "@/test/db/sender";
import { runLocalSql } from "@/test/db/sql";
import { createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";

type Person = { inviteeId: string; hash: string };

let owner: TestUser;
let workspace: TestWorkspace;
let meeting: string;
let startsAt: string;
let a: Person;
let b: Person;
let c: Person;

const DAY = 86_400_000;
function daysAhead(days: number): string {
  const at = new Date(Date.now() + days * DAY);
  at.setUTCHours(17, 0, 0, 0);
  return at.toISOString();
}

async function contact(fullName: string) {
  const { data, error } = await adminClient()
    .from("contacts")
    .insert({
      workspace_id: workspace.id,
      full_name: fullName,
      email: `${crypto.randomUUID().slice(0, 8)}@example.test`,
    })
    .select("id")
    .single();
  if (error) {
    throw error;
  }
  return data.id;
}

async function answer(who: Person, status: "attending" | "absent") {
  const { data, error } = await adminClient().rpc("token_submit_response", {
    p_token_hash: who.hash,
    p_status: status,
    p_delay_minutes: null,
    p_reason: status === "absent" ? "Exam" : null,
    p_comment: null,
  } as never);
  if (error) {
    throw error;
  }
  return data;
}

async function moveMeeting(to = daysAhead(4)) {
  const { error } = await owner.client.rpc("edit_sent_meeting", {
    p_meeting: meeting,
    p_fields: { starts_at: to },
    p_notify: false,
    p_dry_run: false,
  });
  if (error) {
    throw error;
  }
}

async function response(who: Person) {
  const { data } = await adminClient()
    .from("responses")
    .select("needs_reconfirmation, updated_at")
    .eq("invitee_id", who.inviteeId)
    .single();
  return data;
}

async function historyCount(who: Person) {
  const { count } = await adminClient()
    .from("response_history")
    .select("id", { count: "exact", head: true })
    .eq("invitee_id", who.inviteeId);
  return count;
}

const tokenSchema = z.object({
  meeting: z.object({ previous_starts_at: z.string().nullable() }).loose(),
  answer: z.object({ needs_reconfirmation: z.boolean() }).loose().nullable(),
});

const resultsSchema = z.object({
  answers: z
    .object({
      attending: z.number(),
      to_reconfirm: z.number(),
      remindable: z.number(),
      reachable: z.number(),
    })
    .loose(),
  checked_in: z.number(),
  nudge: z.object({
    last_at: z.string().nullable(),
    last_count: z.number().nullable(),
    next_at: z.string().nullable(),
  }),
});

const peopleSchema = z.object({
  has_more: z.boolean(),
  items: z.array(
    z
      .object({
        invitee_id: z.uuid(),
        full_name: z.string(),
        answer: z
          .object({ needs_reconfirmation: z.boolean() })
          .loose()
          .nullable(),
        mark: z
          .object({
            actual: z.string(),
            marked_at: z.string(),
            marked_by_name: z.string().nullable(),
          })
          .nullable(),
      })
      .loose(),
  ),
});

async function people(filter: string, search: string | null = null) {
  const { data, error } = await owner.client.rpc("meeting_people", {
    p_meeting: meeting,
    p_filter: filter,
    p_limit: 50,
    p_search: search,
  } as never);
  if (error) {
    throw error;
  }
  return peopleSchema.parse(data).items;
}

async function results() {
  const { data, error } = await owner.client.rpc("meeting_results", {
    p_meeting: meeting,
  });
  if (error) {
    throw error;
  }
  return resultsSchema.parse(data);
}

beforeEach(async () => {
  parkAllJobs();
  owner = await createTestUser({ fullName: "Owner Person" });
  workspace = await createWorkspaceAs(owner, "Reads Club");
  await setSender(workspace.id, await seedConnection(owner.id));
  startsAt = daysAhead(3);
  meeting = await seedMeeting(workspace.id, {
    status: "scheduled",
    starts_at: startsAt,
  });
  a = await seedInvitee(workspace.id, meeting, await contact("Amira Ben Ali"));
  b = await seedInvitee(workspace.id, meeting, await contact("Sârra Trabelsi"));
  c = await seedInvitee(workspace.id, meeting, await contact("100% Youssef"));
  await answer(a, "attending");
  await answer(b, "absent");
});

describe("reconfirmation", () => {
  it("clears the flag on the same answer with one history row, and on a new answer", async () => {
    await moveMeeting();
    const before = await response(a);
    expect(before?.needs_reconfirmation).toBe(true);
    const historyBefore = await historyCount(a);
    const saved = z
      .object({ needs_reconfirmation: z.boolean() })
      .loose()
      .parse(await answer(a, "attending"));
    expect(saved.needs_reconfirmation).toBe(false);
    const after = await response(a);
    expect(after?.needs_reconfirmation).toBe(false);
    expect(after?.updated_at).not.toBe(before?.updated_at);
    expect(await historyCount(a)).toBe((historyBefore ?? 0) + 1);
    await answer(a, "attending");
    expect(await historyCount(a)).toBe((historyBefore ?? 0) + 1);
    await answer(b, "attending");
    expect((await response(b))?.needs_reconfirmation).toBe(false);
  });

  it("tells the answer page the old time while the person is to reconfirm", async () => {
    await moveMeeting();
    const read = async () =>
      tokenSchema.parse(
        (await adminClient().rpc("token_invitee", { p_token_hash: a.hash }))
          .data,
      );
    let info = await read();
    expect(info.answer?.needs_reconfirmation).toBe(true);
    expect(new Date(info.meeting.previous_starts_at ?? "").getTime()).toBe(
      new Date(startsAt).getTime(),
    );
    await answer(a, "attending");
    info = await read();
    expect(info.answer?.needs_reconfirmation).toBe(false);
    expect(info.meeting.previous_starts_at).toBeNull();
  });
});

describe("previous time after two moves (review)", () => {
  it("strikes through the time the person agreed to, not the latest one", async () => {
    await moveMeeting(daysAhead(4));
    await moveMeeting(daysAhead(5));
    const { data } = await adminClient().rpc("token_invitee", {
      p_token_hash: a.hash,
    });
    expect(
      new Date(
        tokenSchema.parse(data).meeting.previous_starts_at ?? "",
      ).getTime(),
    ).toBe(new Date(startsAt).getTime());
  });
});

describe("meeting_results (M6)", () => {
  it("counts no one to remind for an announcement or anyone already waiting for a reminder (review)", async () => {
    await adminClient()
      .from("outbox_jobs")
      .insert({
        kind: "reminder",
        workspace_id: workspace.id,
        invitee_id: c.inviteeId,
        meeting_id: meeting,
        payload: { audience: "pending" },
        idempotency_key: `reminder:${c.inviteeId}:test`,
      });
    expect((await results()).answers.remindable).toBe(0);
    await adminClient()
      .from("meetings")
      .update({ response_mode: "announcement" })
      .eq("id", meeting);
    await adminClient()
      .from("outbox_jobs")
      .update({ status: "done" })
      .eq("invitee_id", c.inviteeId)
      .eq("kind", "reminder");
    expect((await results()).answers.remindable).toBe(0);
  });

  it("splits out people to reconfirm and counts who a nudge or a cancel would email", async () => {
    await moveMeeting();
    let counts = await results();
    expect(counts.answers).toMatchObject({
      attending: 0,
      to_reconfirm: 2,
      remindable: 3,
      reachable: 3,
    });
    expect(counts.nudge).toEqual({
      last_at: null,
      last_count: null,
      next_at: null,
    });
    expect(
      (await owner.client.rpc("nudge_meeting", { p_meeting: meeting })).error,
    ).toBeNull();
    counts = await results();
    expect(counts.nudge.last_count).toBe(3);
    expect(
      Math.abs(
        new Date(counts.nudge.next_at ?? "").getTime() -
          (Date.now() + 12 * 3600_000),
      ),
    ).toBeLessThan(60_000);
  });

  it("counts check-ins", async () => {
    await adminClient().from("attendance_marks").insert({
      invitee_id: c.inviteeId,
      workspace_id: workspace.id,
      meeting_id: meeting,
      actual: "present",
      marked_by: owner.id,
    });
    expect((await results()).checked_in).toBe(1);
  });
});

describe("meeting_people (M6)", () => {
  it("filters people to reconfirm and keeps them out of their old answer", async () => {
    await moveMeeting();
    expect(
      (await people("to_reconfirm")).map((p) => p.invitee_id).sort(),
    ).toEqual([a.inviteeId, b.inviteeId].sort());
    expect(await people("attending")).toEqual([]);
    const [amira] = await people("all", "ami");
    expect(amira.answer?.needs_reconfirmation).toBe(true);
  });

  it("searches names without accents, and treats % as a plain character", async () => {
    expect((await people("all", "ami")).map((p) => p.full_name)).toEqual([
      "Amira Ben Ali",
    ]);
    expect((await people("all", "sarra")).map((p) => p.full_name)).toEqual([
      "Sârra Trabelsi",
    ]);
    expect((await people("all", "%")).map((p) => p.full_name)).toEqual([
      "100% Youssef",
    ]);
    const { error } = await owner.client.rpc("meeting_people", {
      p_meeting: meeting,
      p_filter: "all",
      p_limit: 50,
      p_search: "x".repeat(121),
    } as never);
    expect(error?.message).toBe("tn:invalid_input");
  });

  it("shows a check-in with the name of who marked it", async () => {
    await adminClient().from("attendance_marks").insert({
      invitee_id: c.inviteeId,
      workspace_id: workspace.id,
      meeting_id: meeting,
      actual: "present",
      marked_by: owner.id,
    });
    const row = (await people("all")).find((p) => p.invitee_id === c.inviteeId);
    expect(row?.mark).toMatchObject({
      actual: "present",
      marked_by_name: "Owner Person",
    });
  });
});

describe("plans at workspace size", () => {
  it("reads a 1,000-person meeting through indexes and edits it in under a second", async () => {
    const bulk = await seedContacts(
      workspace.id,
      1997, // 2,000 with the three people above (the workspace cap)
      `reads-${crypto.randomUUID().slice(0, 6)}`,
    );
    const { data: invitees, error } = await adminClient()
      .from("meeting_invitees")
      .insert(
        bulk.slice(0, 1000).map((id) => ({
          workspace_id: workspace.id,
          meeting_id: meeting,
          contact_id: id,
          email_status: "sent" as const,
        })),
      )
      .select("id");
    expect(error).toBeNull();
    const answered = (invitees ?? []).slice(0, 500).map((row) => ({
      workspace_id: workspace.id,
      meeting_id: meeting,
      invitee_id: row.id,
      status: "attending" as const,
    }));
    expect(
      (await adminClient().from("responses").insert(answered)).error,
    ).toBeNull();
    for (const table of [
      "meeting_invitees",
      "responses",
      "contacts",
      "attendance_marks",
    ]) {
      runLocalSql(`analyze public.${table}`);
    }
    // The index choice of meeting_people is pinned by results.db.test.ts (a small meeting next to a
    // big one); here the meeting is half of the table on a fresh database, so a scan can be right.
    // The search, the check-in join and the reconfirm filter must keep a page fast.
    await people("all", "reads");
    const paging = performance.now();
    await people("to_reconfirm", "reads");
    expect(performance.now() - paging).toBeLessThan(300);
    // meeting_results reads every invitee of the meeting: with the meeting holding half of a fresh
    // table (CI), a full scan is the right plan, so only its speed is pinned (with the edit below).
    // Warm the caches once (a fresh database, as in CI, pays for its first reads), then measure.
    await owner.client.rpc("meeting_results", { p_meeting: meeting });
    await owner.client.rpc("edit_sent_meeting", {
      p_meeting: meeting,
      p_fields: { starts_at: daysAhead(6) },
      p_notify: false,
      p_dry_run: true,
    });
    const counting = performance.now();
    await owner.client.rpc("meeting_results", { p_meeting: meeting });
    expect(performance.now() - counting).toBeLessThan(500);
    const started = performance.now();
    await moveMeeting(daysAhead(5));
    expect(performance.now() - started).toBeLessThan(1000);
  }, 60_000);
});
