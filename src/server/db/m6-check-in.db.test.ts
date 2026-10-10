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
import { explainCall } from "@/test/db/plans";
import { seedContacts } from "@/test/db/roster";
import { runLocalSql } from "@/test/db/sql";
import {
  addMember,
  createWorkspaceAs,
  type TestWorkspace,
} from "@/test/db/workspaces";

type Person = { inviteeId: string; hash: string; contactId: string };

let owner: TestUser;
let admin: TestUser;
let viewer: TestUser;
let checker: TestUser;
let workspace: TestWorkspace;
let meeting: string;
let a: Person;
let b: Person;
let c: Person;
let d: Person;
let e: Person;

const HOUR = 3_600_000;
const ago = (hours: number) =>
  new Date(Date.now() - hours * HOUR).toISOString();

async function person(
  meetingId: string,
  name: string,
  emailStatus: "sent" | "failed" = "sent",
): Promise<Person> {
  const { data, error } = await adminClient()
    .from("contacts")
    .insert({
      workspace_id: workspace.id,
      full_name: name,
      email: `${crypto.randomUUID().slice(0, 8)}@example.test`,
    })
    .select("id")
    .single();
  if (error) {
    throw error;
  }
  const seeded = await seedInvitee(workspace.id, meetingId, data.id, {
    emailStatus,
  });
  return { ...seeded, contactId: data.id };
}

async function answer(who: Person, status: "attending" | "late" | "absent") {
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

const startedAgo = (id: string, hours: number) =>
  adminClient()
    .from("meetings")
    .update({ starts_at: ago(hours) })
    .eq("id", id);

const mark = (
  who: Person,
  actual: "present" | "late" | "absent" | null,
  client = owner.client,
  meetingId = meeting,
) =>
  client.rpc("mark_attendance", {
    p_meeting: meetingId,
    p_invitee: who.inviteeId,
    p_actual: actual,
  } as never);

async function marks() {
  const { data } = await adminClient()
    .from("attendance_marks")
    .select("invitee_id, actual, marked_by")
    .eq("meeting_id", meeting);
  return Object.fromEntries((data ?? []).map((row) => [row.invitee_id, row]));
}

const historySchema = z.object({
  counts: z.object({
    attending: z.number(),
    late: z.number(),
    absent: z.number(),
    no_reply: z.number(),
  }),
  items: z.array(
    z
      .object({
        meeting_id: z.uuid(),
        answer: z.object({ status: z.string() }).loose().nullable(),
        mark: z
          .object({ actual: z.string(), marked_by_name: z.string().nullable() })
          .loose()
          .nullable(),
      })
      .loose(),
  ),
});

async function history(who: Person) {
  const { data, error } = await owner.client.rpc("contact_history", {
    p_contact: who.contactId,
    p_from: null,
    p_to: null,
    p_after_starts: null,
    p_after_meeting: null,
    p_limit: 50,
  } as never);
  if (error) {
    throw error;
  }
  return historySchema.parse(data);
}

async function summary() {
  const { data, error } = await owner.client.rpc("attendance_summary", {
    p_workspace: workspace.id,
    p_from: null,
    p_to: null,
  } as never);
  if (error) {
    throw error;
  }
  return z
    .object({
      rows: z.array(
        z
          .object({
            contact_id: z.uuid(),
            attending: z.number(),
            absent: z.number(),
          })
          .loose(),
      ),
    })
    .parse(data).rows;
}

async function details() {
  const { data, error } = await owner.client.rpc("attendance_details", {
    p_workspace: workspace.id,
    p_from: null,
    p_to: null,
    p_after_starts: null,
    p_after_meeting: null,
    p_after_name: null,
    p_after_invitee: null,
    p_limit: 100,
  } as never);
  if (error) {
    throw error;
  }
  return z
    .object({
      items: z.array(
        z
          .object({
            invitee_id: z.uuid(),
            meeting_id: z.uuid(),
            mark: z
              .object({
                actual: z.string(),
                marked_by_name: z.string().nullable(),
              })
              .loose()
              .nullable(),
          })
          .loose(),
      ),
    })
    .parse(data).items;
}

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Owner Person" });
  admin = await createTestUser({ fullName: "Admin Person" });
  viewer = await createTestUser({ fullName: "Plain Viewer" });
  checker = await createTestUser({ fullName: "Door Viewer" });
  workspace = await createWorkspaceAs(owner, "Check-in Club");
  await addMember(workspace.id, admin.id, "admin");
  await addMember(workspace.id, viewer.id, "viewer");
  await addMember(workspace.id, checker.id, "viewer", true);
  meeting = await seedMeeting(workspace.id, { status: "scheduled" });
  a = await person(meeting, "Amira");
  b = await person(meeting, "Bilel");
  c = await person(meeting, "Chiraz");
  d = await person(meeting, "Dhia");
  e = await person(meeting, "Emna", "failed");
  await answer(a, "attending");
  await answer(b, "late");
  await answer(c, "absent");
  await startedAgo(meeting, 1);
});

describe("mark_attendance", () => {
  it("lets Owners, Admins and check-in Viewers mark people; nobody else", async () => {
    expect((await mark(a, "present")).error).toBeNull();
    expect((await mark(a, "present", admin.client)).error).toBeNull();
    expect((await mark(a, "present", checker.client)).error).toBeNull();
    await expectAppError(mark(a, "present", viewer.client), "forbidden");
    const stranger = await createTestUser();
    await createWorkspaceAs(stranger, "Other Club");
    await expectAppError(mark(a, "present", stranger.client), "not_found");
  });

  it("opens only once a meeting that asks for answers has started", async () => {
    const tomorrow = await seedMeeting(workspace.id, { status: "scheduled" });
    const t = await person(tomorrow, "Taha");
    await expectAppError(
      mark(t, "present", owner.client, tomorrow),
      "check_in_closed",
    );
    const news = await seedMeeting(workspace.id, {
      status: "scheduled",
      response_mode: "announcement",
    });
    const n = await person(news, "Nour");
    await startedAgo(news, 1);
    await expectAppError(
      mark(n, "present", owner.client, news),
      "check_in_closed",
    );
    const cancelled = await seedMeeting(workspace.id, { status: "cancelled" });
    const x = await person(cancelled, "Xena");
    await startedAgo(cancelled, 1);
    await expectAppError(
      mark(x, "present", owner.client, cancelled),
      "check_in_closed",
    );
  });

  it("keeps one mark per person, by the last person who marked, and clears it", async () => {
    await mark(a, "absent");
    const { data } = await mark(a, "present", checker.client);
    expect(data).toMatchObject({
      actual: "present",
      marked_by_name: "Door Viewer",
    });
    expect((await marks())[a.inviteeId]).toMatchObject({
      actual: "present",
      marked_by: checker.id,
    });
    expect((await mark(a, null)).data).toBeNull();
    expect(await marks()).toEqual({});
    const other = await seedMeeting(workspace.id, { status: "scheduled" });
    const o = await person(other, "Omar");
    await expectAppError(mark(o, "present"), "not_found");
  });
});

describe("mark_rest_as_declared", () => {
  it("marks everyone left from what they said; no reply counts as absent", async () => {
    await mark(a, "absent");
    const rest = () =>
      owner.client.rpc("mark_rest_as_declared", { p_meeting: meeting });
    expect((await rest()).data).toBe(3);
    const all = await marks();
    expect(all[a.inviteeId].actual).toBe("absent");
    expect(all[b.inviteeId].actual).toBe("late");
    expect(all[c.inviteeId].actual).toBe("absent");
    expect(all[d.inviteeId].actual).toBe("absent");
    expect(all[e.inviteeId]).toBeUndefined();
    expect((await rest()).data).toBe(0);
  });
});

describe("History and Attendance count the check-in", () => {
  it("counts what happened in the person's history, next to what they said", async () => {
    await mark(a, "absent");
    await mark(d, "present");
    const amira = await history(a);
    expect(amira.counts).toMatchObject({ attending: 0, absent: 1 });
    expect(amira.items[0]).toMatchObject({
      answer: { status: "attending" },
      mark: { actual: "absent", marked_by_name: "Owner Person" },
    });
    expect((await history(d)).counts).toMatchObject({
      attending: 1,
      no_reply: 0,
    });
  });

  it("counts the check-in in Attendance", async () => {
    await mark(a, "absent");
    expect(
      (await summary()).find((row) => row.contact_id === a.contactId),
    ).toMatchObject({ attending: 0, absent: 1 });
    expect(
      (await details()).find((row) => row.invitee_id === a.inviteeId)?.mark,
    ).toMatchObject({ actual: "absent", marked_by_name: "Owner Person" });
  });

  it("never counts a cancelled meeting", async () => {
    await mark(a, "present");
    await adminClient()
      .from("meetings")
      .update({ status: "cancelled" })
      .eq("id", meeting);
    expect((await history(a)).items).toEqual([]);
    expect(
      (await summary()).find((row) => row.contact_id === a.contactId),
    ).toMatchObject({ attending: 0, absent: 0 });
    expect(
      (await details()).filter((row) => row.meeting_id === meeting),
    ).toEqual([]);
  });
});

describe("plans at workspace size", () => {
  it("reads Attendance for 20 meetings of 100 people quickly", async () => {
    const contacts = await seedContacts(
      workspace.id,
      1995, // 2,000 with the five people above (the workspace cap)
      `ci-${crypto.randomUUID().slice(0, 6)}`,
    );
    for (let k = 0; k < 20; k += 1) {
      const id = await seedMeeting(workspace.id, { status: "scheduled" });
      const { data: invitees, error } = await adminClient()
        .from("meeting_invitees")
        .insert(
          contacts.slice(k * 100, k * 100 + 100).map((contact) => ({
            workspace_id: workspace.id,
            meeting_id: id,
            contact_id: contact,
            email_status: "sent" as const,
          })),
        )
        .select("id");
      expect(error).toBeNull();
      const markRows = (invitees ?? []).slice(0, 50).map((row) => ({
        invitee_id: row.id,
        workspace_id: workspace.id,
        meeting_id: id,
        actual: "present" as const,
      }));
      expect(
        (await adminClient().from("attendance_marks").insert(markRows)).error,
      ).toBeNull();
      await startedAgo(id, 2 + k);
    }
    for (const table of [
      "meeting_invitees",
      "responses",
      "attendance_marks",
      "meetings",
      "contacts",
    ]) {
      runLocalSql(`analyze public.${table}`);
    }
    let started = performance.now();
    await summary();
    expect(performance.now() - started).toBeLessThan(500);
    started = performance.now();
    await details();
    expect(performance.now() - started).toBeLessThan(500);
    const plan = explainCall(
      `public.attendance_details('${workspace.id}', null, null, null, null, null, null, 50)`,
      owner.id,
    );
    expect(/Seq Scan on meeting_invitees\b/.test(plan)).toBe(false);
    // attendance_marks is read by its key per row, or hashed once; never re-scanned per row.
    expect(/Nested Loop[\s\S]*Seq Scan on attendance_marks/.test(plan)).toBe(
      false,
    );
  }, 120_000);
});
