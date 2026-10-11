import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adminClient,
  createTestUser,
  expectAppError,
  type TestUser,
} from "@/test/db/clients";
import { seedInvitee } from "@/test/db/invitees";
import { seedMeeting } from "@/test/db/meetings";
import { parkAllJobs, serviceRpc } from "@/test/db/outbox";
import { seedContacts } from "@/test/db/roster";
import { seedConnection, setSender } from "@/test/db/sender";
import { runLocalSql } from "@/test/db/sql";
import { createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";

type Person = { inviteeId: string; hash: string };

const DAY = 86_400_000;
const HOUR = 3_600_000;
function daysAhead(days: number): string {
  const at = new Date(Date.now() + days * DAY);
  at.setUTCHours(17, 0, 0, 0);
  return at.toISOString();
}

let owner: TestUser;
let workspace: TestWorkspace;
let contacts: string[];
let sender: string;

async function answer(who: Person, status: "attending" | "absent") {
  const { error } = await adminClient().rpc("token_submit_response", {
    p_token_hash: who.hash,
    p_status: status,
    p_delay_minutes: null,
    p_reason: status === "absent" ? "Exam" : null,
    p_comment: null,
  } as never);
  if (error) {
    throw error;
  }
}

const edit = (
  meeting: string,
  fields: Record<string, string | number | null>,
  dryRun = false,
) =>
  owner.client.rpc("edit_sent_meeting", {
    p_meeting: meeting,
    p_fields: fields,
    p_notify: false,
    p_dry_run: dryRun,
  });

const editSchema = z.object({ reminders_skipped: z.array(z.string()) });
/** `dispatch_claim` leases one sender's due jobs (null when none). */
const claimSchema = z
  .object({ jobs: z.array(z.object({ job_id: z.uuid() })) })
  .nullable();
async function claimAll(): Promise<string[]> {
  const data = await serviceRpc("dispatch_claim", {
    p_run: crypto.randomUUID(),
    p_limit: 50,
    p_lease_seconds: 70,
  });
  return (claimSchema.parse(data)?.jobs ?? []).map((job) => job.job_id);
}

async function updateJobs(meeting: string) {
  const { data } = await adminClient()
    .from("outbox_jobs")
    .select("id, invitee_id, status, last_error, payload, run_after")
    .eq("meeting_id", meeting)
    .eq("kind", "update")
    .order("created_at");
  return z
    .array(
      z.object({
        id: z.uuid(),
        invitee_id: z.uuid().nullable(),
        status: z.string(),
        last_error: z.string().nullable(),
        payload: z.object({
          changes: z.record(z.string(), z.tuple([z.json(), z.json()])),
        }),
      }),
    )
    .parse(data);
}

const dueNow = (jobId: string) =>
  runLocalSql(
    `update public.outbox_jobs set run_after = now() - interval '1 second' where id = '${jobId}'`,
  );

beforeEach(async () => {
  parkAllJobs();
  owner = await createTestUser({ fullName: "Owner" });
  workspace = await createWorkspaceAs(owner, "Edits Club");
  sender = (await seedConnection(owner.id)).id;
  await setSender(workspace.id, sender);
  contacts = await seedContacts(
    workspace.id,
    5,
    `m7e-${crypto.randomUUID().slice(0, 6)}`,
  );
});

describe("#255 edits, cancel and check-in", () => {
  it("a lead time past the time left is named in the preview and the save", async () => {
    const meeting = await seedMeeting(workspace.id, {
      status: "scheduled",
      starts_at: new Date(Date.now() + 3 * HOUR).toISOString(),
      reminder_pending_hours: 24,
    });
    await seedInvitee(workspace.id, meeting, contacts[0]);
    const preview = await edit(meeting, { reminder_going_hours: 6 }, true);
    expect(editSchema.parse(preview.data).reminders_skipped).toEqual(["going"]);
    const saved = await edit(meeting, { reminder_going_hours: 6 });
    expect(editSchema.parse(saved.data).reminders_skipped).toEqual(["going"]);
    const { data } = await adminClient()
      .from("outbox_jobs")
      .select("id")
      .eq("meeting_id", meeting)
      .eq("kind", "reminder")
      .is("invitee_id", null)
      .eq("payload->>audience", "going");
    expect(data).toEqual([]);
  });

  it("Delete says the cancellation emails wait for Gmail", async () => {
    const meeting = await seedMeeting(workspace.id, {
      status: "scheduled",
      starts_at: daysAhead(3),
    });
    await seedInvitee(workspace.id, meeting, contacts[0]);
    await seedInvitee(workspace.id, meeting, contacts[1]);
    await setSender(workspace.id, null);
    expect(
      (await owner.client.rpc("cancel_meeting", { p_meeting: meeting })).error,
    ).toBeNull();
    runLocalSql(
      `update public.outbox_jobs set run_after = now() - interval '1 second' where meeting_id = '${meeting}' and kind = 'cancel'`,
    );
    await claimAll();
    await expectAppError(
      owner.client.rpc("delete_cancelled_meeting", { p_meeting: meeting }),
      "cancel_emails_waiting",
    );
    await setSender(workspace.id, sender);
    runLocalSql(
      `update public.outbox_jobs set status = 'pending' where meeting_id = '${meeting}' and kind = 'cancel'`,
    );
    await expectAppError(
      owner.client.rpc("delete_cancelled_meeting", { p_meeting: meeting }),
      "cancel_emails_pending",
    );
  });

  it("the check-in total leaves out invites that never went out", async () => {
    const meeting = await seedMeeting(workspace.id, {
      status: "scheduled",
      starts_at: daysAhead(3),
    });
    for (const contact of contacts.slice(0, 3)) {
      await seedInvitee(workspace.id, meeting, contact);
    }
    const failed = await seedInvitee(workspace.id, meeting, contacts[3], {
      emailStatus: "failed",
    });
    await seedInvitee(workspace.id, meeting, contacts[4], {
      emailStatus: "skipped",
    });
    const total = async () =>
      z
        .object({ check_in_total: z.number() })
        .parse(
          (await owner.client.rpc("meeting_results", { p_meeting: meeting }))
            .data,
        ).check_in_total;
    expect(await total()).toBe(3);
    await adminClient().from("attendance_marks").insert({
      workspace_id: workspace.id,
      meeting_id: meeting,
      invitee_id: failed.inviteeId,
      actual: "present",
      marked_by: owner.id,
    });
    expect(await total()).toBe(4);
  });

  it("a retried update and a newer one send one email with both changes", async () => {
    const meeting = await seedMeeting(workspace.id, {
      status: "scheduled",
      starts_at: daysAhead(3),
      location_text: "Room A",
    });
    await seedInvitee(workspace.id, meeting, contacts[0]);
    expect((await edit(meeting, { location_text: "Room B" })).error).toBeNull();
    const [first] = await updateJobs(meeting);
    dueNow(first.id);
    expect(await claimAll()).toEqual([first.id]);
    expect((await edit(meeting, { location_text: "Room C" })).error).toBeNull();
    await serviceRpc("dispatch_retry", {
      p_job: first.id,
      p_error: "HTTP 503",
    });
    // A later run picks the retry up (the first run's sender lease is over).
    runLocalSql("delete from public.sender_leases");
    dueNow(first.id);
    expect(await claimAll()).toEqual([first.id]);
    expect(await serviceRpc("dispatch_reserve", { p_job: first.id })).toEqual({
      kind: "done",
    });
    const jobs = await updateJobs(meeting);
    expect(jobs.find((job) => job.id === first.id)).toMatchObject({
      status: "done",
      last_error: "superseded",
    });
    const newer = jobs.find((job) => job.id !== first.id);
    expect(newer?.payload.changes.location_text).toEqual(["Room A", "Room C"]);
  });

  it("the change line's old value is what the person was last told", async () => {
    const meeting = await seedMeeting(workspace.id, {
      status: "scheduled",
      starts_at: daysAhead(3),
      location_text: "X",
    });
    const a = await seedInvitee(workspace.id, meeting, contacts[0]);
    const b = await seedInvitee(workspace.id, meeting, contacts[1]);
    await answer(a, "attending");
    await answer(b, "absent");
    expect((await edit(meeting, { location_text: "Y" })).error).toBeNull();
    const [toldA] = await updateJobs(meeting);
    expect(toldA.invitee_id).toBe(a.inviteeId);
    dueNow(toldA.id);
    expect(await claimAll()).toEqual([toldA.id]);
    await serviceRpc("dispatch_finish", {
      p_job: toldA.id,
      p_outcome: "sent",
      p_error: null,
      p_token_hash: null,
    });
    await answer(b, "attending");
    expect((await edit(meeting, { location_text: "Z" })).error).toBeNull();
    const pending = (await updateJobs(meeting)).filter(
      (job) => job.status === "pending",
    );
    const lineOf = (who: Person) =>
      pending.find((job) => job.invitee_id === who.inviteeId)?.payload.changes
        .location_text;
    expect(lineOf(a)).toEqual(["Y", "Z"]);
    expect(lineOf(b)).toEqual(["X", "Z"]);
  });
});
