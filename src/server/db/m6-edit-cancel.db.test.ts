import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  CALENDAR_FIELDS,
  EDITABLE_FIELDS,
  MEMBER_VISIBLE_FIELDS,
  PLACE_FIELDS,
  SCHEDULE_FIELDS,
} from "@/config/meeting-edit";
import {
  adminClient,
  createTestUser,
  expectAppError,
  type TestUser,
} from "@/test/db/clients";
import { seedInvitee } from "@/test/db/invitees";
import { seedMeeting } from "@/test/db/meetings";
import {
  overrideLimit,
  parkAllJobs,
  serviceRpc,
  timersOf,
} from "@/test/db/outbox";
import { seedContacts } from "@/test/db/roster";
import { seedConnection, setSender } from "@/test/db/sender";
import { queryLocalSql, runLocalSql } from "@/test/db/sql";
import {
  addMember,
  createWorkspaceAs,
  type TestWorkspace,
} from "@/test/db/workspaces";

type Person = { inviteeId: string; hash: string };

let owner: TestUser;
let workspace: TestWorkspace;
let meeting: string;
let startsAt: string;
let a: Person;
let b: Person;
let c: Person;
let d: Person;
let contactIds: string[];

const DAY = 86_400_000;
/** A whole-minute UTC instant `days` ahead at 17:00 (Postgres echoes it back the same way). */
function daysAhead(days: number): string {
  const at = new Date(Date.now() + days * DAY);
  at.setUTCHours(17, 0, 0, 0);
  return at.toISOString();
}
const sameInstant = (x: string | null | undefined, y: string) =>
  new Date(x ?? "").getTime() === new Date(y).getTime();

const resultSchema = z.object({
  changed: z.boolean(),
  changes: z.record(z.string(), z.tuple([z.json(), z.json()])),
  emails: z.number(),
  calendar_only: z.number(),
  reconfirm: z.boolean(),
});
const jobSchema = z.object({
  invitee_id: z.uuid().nullable(),
  status: z.string(),
  last_error: z.string().nullable(),
  payload: z.object({
    changes: z.record(z.string(), z.tuple([z.json(), z.json()])).optional(),
    notify: z.boolean().optional(),
    reconfirm: z.boolean().optional(),
  }),
});

async function edit(
  fields: Record<string, string | number | boolean | number[] | null>,
  notify = false,
  dryRun = false,
  client = owner.client,
) {
  return client.rpc("edit_sent_meeting", {
    p_meeting: meeting,
    p_fields: fields,
    p_notify: notify,
    p_dry_run: dryRun,
  });
}

async function editOk(
  fields: Record<string, string | number | boolean | null>,
  notify = false,
  dryRun = false,
) {
  const { data, error } = await edit(fields, notify, dryRun);
  if (error) {
    throw error;
  }
  return resultSchema.parse(data);
}

async function jobsOfKind(kind: string, statuses = ["pending", "paused"]) {
  const { data } = await adminClient()
    .from("outbox_jobs")
    .select("invitee_id, status, last_error, payload")
    .eq("meeting_id", meeting)
    .eq("kind", kind as "update")
    .in("status", statuses as "pending"[]);
  return z.array(jobSchema).parse(data);
}

const byInvitee = (jobs: z.infer<typeof jobSchema>[], who: Person) =>
  jobs.filter((job) => job.invitee_id === who.inviteeId);

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

async function meetingRow() {
  const { data } = await adminClient()
    .from("meetings")
    .select("status, starts_at, title, ics_sequence, cancelled_at")
    .eq("id", meeting)
    .single();
  return data;
}

async function changeRows() {
  const { data } = await adminClient()
    .from("meeting_changes")
    .select("kind, notified, changed_by, changes")
    .eq("meeting_id", meeting);
  return data ?? [];
}

async function reconfirmFlags() {
  const { data } = await adminClient()
    .from("responses")
    .select("invitee_id, needs_reconfirmation")
    .eq("meeting_id", meeting);
  return Object.fromEntries(
    (data ?? []).map((row) => [row.invitee_id, row.needs_reconfirmation]),
  );
}

/** D's invite as the dispatcher holds it: claimed, and (optionally) already handed to Gmail. */
async function inviteInFlight(sendStarted: boolean) {
  const { error } = await adminClient()
    .from("outbox_jobs")
    .update({
      status: "processing",
      locked_until: new Date(Date.now() + 60_000).toISOString(),
      send_started_at: sendStarted ? new Date().toISOString() : null,
    })
    .eq("invitee_id", d.inviteeId)
    .eq("kind", "invite");
  if (error) {
    throw error;
  }
}

async function finishInvite(outcome: "sent" | "failed") {
  const { data } = await adminClient()
    .from("outbox_jobs")
    .select("id")
    .eq("invitee_id", d.inviteeId)
    .eq("kind", "invite")
    .single();
  await serviceRpc("dispatch_finish", {
    p_job: data?.id ?? "",
    p_outcome: outcome,
    p_error: null,
    p_token_hash: null,
  });
}

const count = (table: string) =>
  queryLocalSql(
    `select count(*)::int as n from public.${table} where meeting_id = '${meeting}'`,
    z.array(z.object({ n: z.number() })),
  )[0].n;

beforeEach(async () => {
  parkAllJobs();
  owner = await createTestUser({ fullName: "Owner" });
  workspace = await createWorkspaceAs(owner, "Edit Club");
  await setSender(workspace.id, await seedConnection(owner.id));
  const contacts = await seedContacts(
    workspace.id,
    4,
    `m6e-${crypto.randomUUID().slice(0, 6)}`,
  );
  contactIds = contacts;
  startsAt = daysAhead(3);
  meeting = await seedMeeting(workspace.id, {
    status: "scheduled",
    starts_at: startsAt,
    reminder_pending_hours: 24,
  });
  a = await seedInvitee(workspace.id, meeting, contacts[0]);
  b = await seedInvitee(workspace.id, meeting, contacts[1]);
  c = await seedInvitee(workspace.id, meeting, contacts[2]);
  d = await seedInvitee(workspace.id, meeting, contacts[3], {
    emailStatus: "queued",
  });
  await adminClient()
    .from("outbox_jobs")
    .insert({
      kind: "invite",
      workspace_id: workspace.id,
      invitee_id: d.inviteeId,
      idempotency_key: `invite:${d.inviteeId}`,
    });
  await answer(a, "attending");
  await answer(b, "absent");
  await adminClient()
    .from("meeting_invitees")
    .update({ calendar_state: "added" })
    .eq("id", a.inviteeId);
  runLocalSql(`select private.sync_reminder_timers('${meeting}')`);
});

describe("edit_sent_meeting", () => {
  it("emails everyone about a time change and asks them to confirm again", async () => {
    const later = daysAhead(4);
    const before = await meetingRow();
    const result = await editOk({ starts_at: later });
    expect(result).toMatchObject({
      changed: true,
      emails: 3,
      calendar_only: 0,
      reconfirm: true,
    });
    expect(await reconfirmFlags()).toEqual({
      [a.inviteeId]: true,
      [b.inviteeId]: true,
    });
    const jobs = await jobsOfKind("update");
    expect(jobs.map((job) => job.invitee_id).sort()).toEqual(
      [a.inviteeId, b.inviteeId, c.inviteeId].sort(),
    );
    for (const job of jobs) {
      expect(job.payload).toMatchObject({ notify: true, reconfirm: true });
      const [old, now] = job.payload.changes?.starts_at ?? [];
      expect(sameInstant(String(old), startsAt)).toBe(true);
      expect(sameInstant(String(now), later)).toBe(true);
    }
    expect(await changeRows()).toEqual([
      expect.objectContaining({
        kind: "edit",
        notified: true,
        changed_by: owner.id,
      }),
    ]);
    const [timer] = await timersOf(meeting);
    expect(
      sameInstant(
        timer.run_after,
        new Date(new Date(later).getTime() - DAY).toISOString(),
      ),
    ).toBe(true);
    expect((await meetingRow())?.ics_sequence).toBe(
      (before?.ics_sequence ?? 0) + 1,
    );
  });

  it("writes nothing on a dry run", async () => {
    const result = await editOk({ starts_at: daysAhead(4) }, false, true);
    expect(result).toMatchObject({
      emails: 3,
      calendar_only: 0,
      reconfirm: true,
    });
    expect(await jobsOfKind("update")).toEqual([]);
    expect(await changeRows()).toEqual([]);
    expect(sameInstant((await meetingRow())?.starts_at, startsAt)).toBe(true);
    expect(Object.values(await reconfirmFlags())).toEqual([false, false]);
  });

  it("refuses a missing dry-run flag instead of saving by surprise (review)", async () => {
    const { error } = await owner.client.rpc("edit_sent_meeting", {
      p_meeting: meeting,
      p_fields: { location_text: "Hall A" },
      p_notify: false,
      p_dry_run: null,
    } as never);
    expect(error?.message).toBe("tn:invalid_input");
    expect(await changeRows()).toEqual([]);
  });

  it("refuses a time that never comes (review)", async () => {
    await expectAppError(edit({ starts_at: "infinity" }), "invalid_input");
  });

  it("tells people whose invite is being sent right now about the change (review)", async () => {
    await inviteInFlight(false);
    const result = await editOk({ starts_at: daysAhead(4) });
    expect(result.emails).toBe(4);
    expect(byInvitee(await jobsOfKind("update"), d)).toHaveLength(1);
    // The update waits for the invite: no claim picks it while D is still queued.
    await adminClient()
      .from("outbox_jobs")
      .update({ run_after: new Date(Date.now() - 1000).toISOString() })
      .eq("meeting_id", meeting)
      .eq("kind", "update");
    const run = crypto.randomUUID();
    const claimed = z
      .object({ jobs: z.array(z.object({ invitee_id: z.uuid() }).loose()) })
      .nullable()
      .parse(
        await serviceRpc("dispatch_claim", {
          p_run: run,
          p_limit: 50,
          p_lease_seconds: 70,
        }),
      );
    expect(claimed?.jobs.map((job) => job.invitee_id)).not.toContain(
      d.inviteeId,
    );
    await serviceRpc("dispatch_release", { p_run: run });
  });

  it("drops the update of someone whose invite then failed (review)", async () => {
    await inviteInFlight(false);
    await editOk({ starts_at: daysAhead(4) });
    await finishInvite("failed");
    const { data: row } = await adminClient()
      .from("outbox_jobs")
      .select("id")
      .eq("invitee_id", d.inviteeId)
      .eq("kind", "update")
      .single();
    await adminClient()
      .from("outbox_jobs")
      .update({
        status: "processing",
        locked_until: new Date(Date.now() + 60_000).toISOString(),
      })
      .eq("id", row?.id ?? "");
    expect(
      await serviceRpc("dispatch_reserve", {
        p_job: row?.id ?? "",
        p_token_hash: null,
      }),
    ).toEqual({ kind: "done" });
    const { data: after } = await adminClient()
      .from("outbox_jobs")
      .select("last_error")
      .eq("id", row?.id ?? "")
      .single();
    expect(after?.last_error).toBe("not_invited");
  });

  it("keeps a reminder that already went out when only its setting changes (review)", async () => {
    const [timer] = await timersOf(meeting);
    await adminClient()
      .from("outbox_jobs")
      .update({ status: "done" })
      .eq("id", timer.id);
    await editOk({ reminder_pending_hours: 2 });
    expect(await timersOf(meeting)).toEqual([]);
  });

  it("emails everyone but people who can't come about a new place", async () => {
    const result = await editOk({ location_text: "Hall A" });
    expect(result).toMatchObject({
      emails: 2,
      calendar_only: 0,
      reconfirm: false,
    });
    expect(
      (await jobsOfKind("update")).map((job) => job.invitee_id).sort(),
    ).toEqual([a.inviteeId, c.inviteeId].sort());
    expect(Object.values(await reconfirmFlags())).toEqual([false, false]);
  });

  it("updates only calendars for a text change, unless asked to email everyone", async () => {
    expect(await editOk({ title: "New title" })).toMatchObject({
      emails: 0,
      calendar_only: 1,
    });
    const [job] = byInvitee(await jobsOfKind("update"), a);
    expect(job.payload.notify).toBe(false);
    expect(await editOk({ title: "Newer" }, true)).toMatchObject({ emails: 3 });
  });

  it("emails nobody about a hidden setting, but logs it", async () => {
    expect(await editOk({ reason_required: false })).toMatchObject({
      emails: 0,
      calendar_only: 0,
    });
    expect(await jobsOfKind("update")).toEqual([]);
    expect(await changeRows()).toEqual([
      expect.objectContaining({ kind: "edit", notified: false }),
    ]);
  });

  it("does nothing when nothing changed", async () => {
    const title = (await meetingRow())?.title ?? "";
    expect(await editOk({ title })).toMatchObject({ changed: false });
    expect(await changeRows()).toEqual([]);
    expect(await jobsOfKind("update")).toEqual([]);
  });

  it("merges quick edits into one email per person with the net change (Review Focus 1)", async () => {
    await editOk({ starts_at: daysAhead(4) });
    await editOk({ location_text: "Hall A" });
    await editOk({ starts_at: startsAt });
    const jobs = await jobsOfKind("update");
    expect(byInvitee(jobs, a)).toHaveLength(1);
    expect(byInvitee(jobs, b)).toHaveLength(1);
    expect(byInvitee(jobs, c)).toHaveLength(1);
    const [job] = byInvitee(jobs, a);
    expect(Object.keys(job.payload.changes ?? {})).toEqual(["location_text"]);
    expect(job.payload).toMatchObject({ notify: true, reconfirm: true });
  });

  it("refuses locked fields and unknown keys", async () => {
    await expectAppError(edit({ response_mode: "rsvp" }), "invalid_input");
    await expectAppError(edit({ delay_options: [5] }), "invalid_input");
    await expectAppError(edit({ nonsense: 1 }), "invalid_input");
  });

  it("applies the meeting rules (Review Focus 3)", async () => {
    await expectAppError(edit({ location_text: "" }), "meeting_incomplete");
    await expectAppError(
      edit({ starts_at: new Date(Date.now() - 3600_000).toISOString() }),
      "meeting_in_past",
    );
    await expectAppError(
      edit({
        response_deadline: new Date(Date.now() - 3600_000).toISOString(),
      }),
      "deadline_in_past",
    );
    const passed = new Date(Date.now() - 2 * 3600_000).toISOString();
    await adminClient()
      .from("meetings")
      .update({ response_deadline: passed })
      .eq("id", meeting);
    expect((await edit({ title: "Typo fix" })).error).toBeNull();
    await expectAppError(
      edit({ starts_at: new Date(Date.now() - 3 * 3600_000).toISOString() }),
      "meeting_in_past",
    );
    // A start before the passed deadline but still ahead cannot exist; a start right at a
    // future deadline is refused with the deadline code.
    const deadline = daysAhead(2);
    await adminClient()
      .from("meetings")
      .update({ response_deadline: deadline })
      .eq("id", meeting);
    await expectAppError(edit({ starts_at: deadline }), "deadline_after_start");
  });

  it("refuses started and cancelled meetings, Viewers and other workspaces", async () => {
    const viewer = await createTestUser();
    await addMember(workspace.id, viewer.id, "viewer");
    await expectAppError(
      edit({ title: "x" }, false, false, viewer.client),
      "forbidden",
    );
    const stranger = await createTestUser();
    await createWorkspaceAs(stranger, "Other Club");
    await expectAppError(
      edit({ title: "x" }, false, false, stranger.client),
      "not_found",
    );
    await adminClient()
      .from("meetings")
      .update({ starts_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", meeting);
    await expectAppError(edit({ title: "x" }), "meeting_started");
    await adminClient()
      .from("meetings")
      .update({ starts_at: daysAhead(3), status: "cancelled" })
      .eq("id", meeting);
    await expectAppError(edit({ title: "x" }), "meeting_cancelled");
  });

  it("schedules the reminder again after a move once it already went out (owner decision)", async () => {
    const [timer] = await timersOf(meeting);
    await adminClient()
      .from("outbox_jobs")
      .update({ status: "done" })
      .eq("id", timer.id);
    const later = daysAhead(7);
    await editOk({ starts_at: later });
    const [again] = await timersOf(meeting);
    expect(again.id).not.toBe(timer.id);
    expect(
      sameInstant(
        again.run_after,
        new Date(new Date(later).getTime() - DAY).toISOString(),
      ),
    ).toBe(true);
  });

  it("limits edits that email people, per organizer (security review)", async () => {
    const restore = overrideLimit("meeting_email_edits_per_user_per_hour", 1);
    try {
      expect((await edit({ location_text: "Hall A" })).error).toBeNull();
      await expectAppError(edit({ location_text: "Hall B" }), "rate_limited");
      // Saving a hidden setting emails nobody, so it is not limited.
      expect((await edit({ reason_required: false })).error).toBeNull();
      // A dry run (Review changes) is not limited either.
      expect(
        (await edit({ location_text: "Hall C" }, false, true)).error,
      ).toBeNull();
    } finally {
      restore();
    }
  });

  it("keeps its field groups equal to src/config/meeting-edit.ts", () => {
    const [{ def }] = queryLocalSql(
      "select pg_get_functiondef('private.edit_sent_meeting(uuid, jsonb, boolean, boolean)'::regprocedure) as def",
      z.array(z.object({ def: z.string() })),
    );
    const list = (name: string) => {
      const match = new RegExp(
        `${name} constant text\\[\\] := array\\[([^\\]]*)\\]`,
      ).exec(def);
      return [...(match?.[1] ?? "").matchAll(/'([a-z_]+)'/g)]
        .map((m) => m[1])
        .sort();
    };
    expect(list("c_editable")).toEqual([...EDITABLE_FIELDS].sort());
    expect(list("c_visible")).toEqual([...MEMBER_VISIBLE_FIELDS].sort());
    expect(list("c_schedule")).toEqual([...SCHEDULE_FIELDS].sort());
    expect(list("c_place")).toEqual([...PLACE_FIELDS].sort());
    expect(list("c_calendar")).toEqual([...CALENDAR_FIELDS].sort());
  });
});

describe("cancel_meeting", () => {
  const cancel = (client = owner.client, id = meeting) =>
    client.rpc("cancel_meeting", { p_meeting: id });

  it("stops everything unsent and emails the people who were invited (Review Focus 2)", async () => {
    await editOk({ title: "Renamed" }, true);
    const { data, error } = await cancel();
    expect(error).toBeNull();
    expect(data).toEqual({ emails: 3 });
    const row = await meetingRow();
    expect(row?.status).toBe("cancelled");
    expect(row?.cancelled_at).not.toBeNull();
    const { data: dInvite } = await adminClient()
      .from("outbox_jobs")
      .select("status, last_error")
      .eq("invitee_id", d.inviteeId)
      .eq("kind", "invite")
      .single();
    expect(dInvite).toEqual({
      status: "done",
      last_error: "meeting_cancelled",
    });
    const { data: dRow } = await adminClient()
      .from("meeting_invitees")
      .select("email_status")
      .eq("id", d.inviteeId)
      .single();
    expect(dRow?.email_status).toBe("skipped");
    expect(await timersOf(meeting)).toEqual([]);
    expect(await jobsOfKind("update")).toEqual([]);
    const { data: calendar } = await adminClient()
      .from("outbox_jobs")
      .select("status")
      .eq("kind", "calendar_confirm")
      .eq("invitee_id", a.inviteeId)
      .in("status", ["pending", "paused"]);
    expect(calendar).toEqual([]);
    expect(
      (await jobsOfKind("cancel")).map((job) => job.invitee_id).sort(),
    ).toEqual([a.inviteeId, b.inviteeId, c.inviteeId].sort());
    expect(await changeRows()).toContainEqual(
      expect.objectContaining({ kind: "cancel", notified: true }),
    );
    await expectAppError(cancel(), "meeting_cancelled");
  });

  it("tells the person whose invite was already handed to Gmail (review)", async () => {
    await inviteInFlight(true);
    const { data } = await cancel();
    expect(data).toEqual({ emails: 4 });
    expect(byInvitee(await jobsOfKind("cancel"), d)).toHaveLength(1);
    const { data: row } = await adminClient()
      .from("meeting_invitees")
      .select("email_status")
      .eq("id", d.inviteeId)
      .single();
    expect(row?.email_status).toBe("queued");
  });

  it("tells the person whose invite was claimed but not yet sent, whichever happens first (review)", async () => {
    // A cancel racing the invite's reserve must never leave someone invited and not told.
    await inviteInFlight(false);
    const { data } = await cancel();
    expect(data).toEqual({ emails: 4 });
    expect(byInvitee(await jobsOfKind("cancel"), d)).toHaveLength(1);
    const { data: invite } = await adminClient()
      .from("outbox_jobs")
      .select("id")
      .eq("invitee_id", d.inviteeId)
      .eq("kind", "invite")
      .single();
    // Reserved after the cancel: the invite is dropped, so the cancellation will be too.
    expect(
      await serviceRpc("dispatch_reserve", {
        p_job: invite?.id ?? "",
        p_token_hash: null,
      }),
    ).toEqual({ kind: "done" });
    const { data: row } = await adminClient()
      .from("meeting_invitees")
      .select("email_status")
      .eq("id", d.inviteeId)
      .single();
    expect(row?.email_status).toBe("skipped");
  });

  it("removes the event from the calendar of someone who unsubscribed after adding it (owner decision)", async () => {
    const { error } = await adminClient()
      .from("contacts")
      .update({
        unsubscribed_at: new Date().toISOString(),
        unsubscribed_via: "link",
      })
      .in("id", [contactIds[0], contactIds[2]]);
    expect(error).toBeNull();
    const { data } = await cancel();
    // a (unsubscribed, event in their calendar) gets only the removal, not counted as an email;
    // c (unsubscribed, no event) gets nothing.
    expect(data).toEqual({ emails: 1 });
    expect(
      (await jobsOfKind("cancel")).map((job) => job.invitee_id).sort(),
    ).toEqual([a.inviteeId, b.inviteeId].sort());
  });

  it("refuses Viewers", async () => {
    const viewer = await createTestUser();
    await addMember(workspace.id, viewer.id, "viewer");
    await expectAppError(cancel(viewer.client), "forbidden");
  });

  it("refuses drafts and started meetings", async () => {
    const draft = await seedMeeting(workspace.id, { status: "draft" });
    await expectAppError(cancel(owner.client, draft), "invalid_input");
    await adminClient()
      .from("meetings")
      .update({ starts_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", meeting);
    await expectAppError(cancel(), "meeting_started");
  });

  it("works without a sender; the emails wait until Gmail is back (Review Focus 4)", async () => {
    await setSender(workspace.id, null);
    expect((await cancel()).error).toBeNull();
    await serviceRpc("dispatch_claim", {
      p_run: crypto.randomUUID(),
      p_limit: 50,
      p_lease_seconds: 70,
    });
    expect(
      (await jobsOfKind("cancel", ["paused"])).map((job) => job.status),
    ).toEqual(["paused", "paused", "paused"]);
    await setSender(workspace.id, await seedConnection(owner.id));
    expect(
      (await jobsOfKind("cancel", ["pending"])).map((job) => job.status),
    ).toEqual(["pending", "pending", "pending"]);
  });
});

describe("delete_cancelled_meeting", () => {
  const remove = (id = meeting, client = owner.client) =>
    client.rpc("delete_cancelled_meeting", { p_meeting: id });

  it("refuses Viewers", async () => {
    const viewer = await createTestUser();
    await addMember(workspace.id, viewer.id, "viewer");
    await owner.client.rpc("cancel_meeting", { p_meeting: meeting });
    await expectAppError(remove(meeting, viewer.client), "forbidden");
  });

  it("keeps abuse reports, without the person's invite (review)", async () => {
    // "Not my group" from B's email, the way members report.
    await adminClient().rpc("token_unsubscribe", {
      p_token_hash: b.hash,
      p_via: "report",
    });
    await owner.client.rpc("cancel_meeting", { p_meeting: meeting });
    await adminClient()
      .from("outbox_jobs")
      .update({ status: "done" })
      .eq("meeting_id", meeting)
      .eq("kind", "cancel");
    expect((await remove()).error).toBeNull();
    const { data } = await adminClient()
      .from("abuse_reports")
      .select("invitee_id, contact_id")
      .eq("workspace_id", workspace.id);
    expect(data).toHaveLength(1);
    expect(data?.[0].invitee_id).toBeNull();
    expect(data?.[0].contact_id).not.toBeNull();
  });

  it("lets a started meeting go even while its cancellation emails wait for Gmail (review)", async () => {
    await setSender(workspace.id, null);
    await owner.client.rpc("cancel_meeting", { p_meeting: meeting });
    await adminClient()
      .from("outbox_jobs")
      .update({ status: "paused" })
      .eq("meeting_id", meeting)
      .eq("kind", "cancel");
    await expectAppError(remove(), "cancel_emails_pending");
    await adminClient()
      .from("meetings")
      .update({ starts_at: new Date(Date.now() - 60_000).toISOString() })
      .eq("id", meeting);
    expect((await remove()).error).toBeNull();
  });

  it("waits for the cancellation emails, then deletes everything of the meeting", async () => {
    await expectAppError(remove(), "invalid_input");
    await owner.client.rpc("cancel_meeting", { p_meeting: meeting });
    await expectAppError(remove(), "cancel_emails_pending");
    await adminClient()
      .from("outbox_jobs")
      .update({ status: "done" })
      .eq("meeting_id", meeting)
      .eq("kind", "cancel");
    await adminClient().from("attendance_marks").insert({
      invitee_id: a.inviteeId,
      workspace_id: workspace.id,
      meeting_id: meeting,
      actual: "present",
    });
    expect((await remove()).error).toBeNull();
    for (const table of [
      "meeting_invitees",
      "responses",
      "response_history",
      "attendance_marks",
      "meeting_changes",
      "outbox_jobs",
    ]) {
      expect(count(table)).toBe(0);
    }
    expect(await meetingRow()).toBeNull();
  });
});
