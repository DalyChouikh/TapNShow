import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { adminClient, createTestUser, type TestUser } from "@/test/db/clients";
import { seedInvitee } from "@/test/db/invitees";
import { seedMeeting } from "@/test/db/meetings";
import { parkAllJobs, serviceRpc } from "@/test/db/outbox";
import { seedContacts } from "@/test/db/roster";
import { seedConnection, setSender } from "@/test/db/sender";
import { queryLocalSql } from "@/test/db/sql";
import { createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";

type Person = { inviteeId: string; hash: string };

const DAY = 86_400_000;
const HOUR = 3_600_000;
/** A whole-minute UTC instant `days` ahead at 17:00 (Postgres echoes it back the same way). */
function daysAhead(days: number): string {
  const at = new Date(Date.now() + days * DAY);
  at.setUTCHours(17, 0, 0, 0);
  return at.toISOString();
}

let owner: TestUser;
let workspace: TestWorkspace;
let meeting: string;
let startsAt: string;
let a: Person;
let b: Person;

async function answer(
  who: Person,
  status: "attending" | "absent",
  seenStartsAt?: string,
) {
  const { error } = await adminClient().rpc("token_submit_response", {
    p_token_hash: who.hash,
    p_status: status,
    p_delay_minutes: null,
    p_reason: status === "absent" ? "Exam" : null,
    p_comment: null,
    ...(seenStartsAt ? { p_seen_starts_at: seenStartsAt } : {}),
  } as never);
  if (error) {
    throw error;
  }
}

async function moveTo(at: string) {
  const { error } = await owner.client.rpc("edit_sent_meeting", {
    p_meeting: meeting,
    p_fields: { starts_at: at },
    p_notify: false,
    p_dry_run: false,
  });
  if (error) {
    throw error;
  }
}

async function flag(who: Person) {
  const { data } = await adminClient()
    .from("responses")
    .select("needs_reconfirmation, after_deadline")
    .eq("invitee_id", who.inviteeId)
    .single();
  return data;
}

async function reminderJob(
  who: Person,
  status: "pending" | "processing",
): Promise<string> {
  const { data, error } = await adminClient()
    .from("outbox_jobs")
    .insert({
      kind: "reminder",
      workspace_id: workspace.id,
      meeting_id: meeting,
      invitee_id: who.inviteeId,
      payload: { audience: "pending" },
      idempotency_key: `reminder:${who.inviteeId}:test-${crypto.randomUUID()}`,
      status,
      ...(status === "processing"
        ? { locked_until: new Date(Date.now() + 60_000).toISOString() }
        : {}),
    })
    .select("id")
    .single();
  if (error) {
    throw error;
  }
  return data.id;
}

beforeEach(async () => {
  parkAllJobs();
  owner = await createTestUser({ fullName: "Owner" });
  workspace = await createWorkspaceAs(owner, "Minors Club");
  await setSender(workspace.id, (await seedConnection(owner.id)).id);
  const contacts = await seedContacts(
    workspace.id,
    2,
    `m7a-${crypto.randomUUID().slice(0, 6)}`,
  );
  startsAt = daysAhead(3);
  meeting = await seedMeeting(workspace.id, {
    status: "scheduled",
    starts_at: startsAt,
    reminder_pending_hours: 24,
  });
  a = await seedInvitee(workspace.id, meeting, contacts[0]);
  b = await seedInvitee(workspace.id, meeting, contacts[1]);
});

describe("#255 answers and reminders", () => {
  it("a time moved and moved back shows no previous time", async () => {
    await answer(a, "attending");
    await moveTo(new Date(new Date(startsAt).getTime() + HOUR).toISOString());
    await moveTo(startsAt);
    const { data } = await adminClient().rpc("token_invitee", {
      p_token_hash: a.hash,
    });
    const parsed = z
      .object({
        meeting: z.object({ previous_starts_at: z.string().nullable() }),
        answer: z.object({ needs_reconfirmation: z.boolean() }),
      })
      .parse(data);
    expect(parsed.meeting.previous_starts_at).toBeNull();
    expect(parsed.answer.needs_reconfirmation).toBe(true);
  });

  it('a waiting "not answered" reminder never holds back "going"', async () => {
    await reminderJob(a, "pending");
    await answer(a, "attending");
    const [row] = queryLocalSql(
      `select private.enqueue_reminders('${meeting}', 'going', 'test') as n`,
      z.array(z.object({ n: z.number() })).length(1),
    );
    expect(row.n).toBe(1);
  });

  it("the reservation tells the reminder that the person must reconfirm", async () => {
    await answer(a, "attending");
    await moveTo(daysAhead(4));
    parkAllJobs();
    const job = await reminderJob(a, "processing");
    expect(await serviceRpc("dispatch_reserve", { p_job: job })).toMatchObject({
      kind: "ok",
      reconfirm: true,
    });
  });

  it("Yes, still going after the deadline writes a history row with after_deadline", async () => {
    await answer(a, "attending");
    await moveTo(daysAhead(4));
    await adminClient()
      .from("meetings")
      .update({
        response_deadline: new Date(Date.now() - 60_000).toISOString(),
      })
      .eq("id", meeting);
    await answer(a, "attending");
    const { data } = await adminClient()
      .from("response_history")
      .select("after_deadline")
      .eq("invitee_id", a.inviteeId)
      .order("changed_at", { ascending: false })
      .limit(1)
      .single();
    expect(data?.after_deadline).toBe(true);
    expect(await flag(a)).toEqual({
      needs_reconfirmation: false,
      after_deadline: false,
    });
  });

  it("an answer from a page opened before the time change keeps the flag", async () => {
    await answer(a, "attending");
    await answer(b, "attending");
    const later = daysAhead(4);
    await moveTo(later);
    await answer(a, "absent", startsAt);
    expect((await flag(a))?.needs_reconfirmation).toBe(true);
    await answer(b, "absent", later);
    expect((await flag(b))?.needs_reconfirmation).toBe(false);
  });
});
