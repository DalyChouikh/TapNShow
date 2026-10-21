import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { INSIGHTS_CHART_MEETINGS, OFTEN_MISSING_PEOPLE } from "@/config/home";
import { sqlNullable } from "@/server/db/rpc-args";
import {
  adminClient,
  anonClient,
  createTestUser,
  expectAppError,
  type TestUser,
} from "@/test/db/clients";
import { createInviteAs } from "@/test/db/invites";
import { hoursFromNow, seedMeeting } from "@/test/db/meetings";
import { seedAnswer, seedContact } from "@/test/db/members";
import { seedContacts, seedList } from "@/test/db/roster";
import { addMember, createWorkspaceAs } from "@/test/db/workspaces";

type EmailStatus = "queued" | "sent" | "skipped" | "failed" | "unknown";
type Answer = "attending" | "late" | "absent" | "not_attending";

const count = z.number().int().nonnegative();

/** The documented shape (Task 1 Interfaces), exactly: Task 2 parses the same keys. */
const insightsSchema = z.strictObject({
  roster: z.strictObject({ members: count, lists: count, committee: count }),
  held: count,
  period: z.strictObject({
    meetings: count,
    came_average: z.number().nonnegative(),
    invited_average: z.number().nonnegative(),
    answered_before_start: z.number().min(0).max(1).nullable(),
  }),
  chart: z.array(
    z.strictObject({
      id: z.uuid(),
      title: z.string(),
      starts_at: z.string(),
      timezone: z.string(),
      attending: count,
      late: count,
      absent: count,
      no_reply: count,
    }),
  ),
  often_missing: z.array(
    z.strictObject({
      contact_id: z.uuid(),
      full_name: z.string(),
      invited: count,
      missed: count,
      absent: count,
      no_reply: count,
    }),
  ),
});

const summarySchema = z.object({
  meetings: count,
  rows: z.array(
    z.object({
      contact_id: z.uuid(),
      invited: count,
      attending: count,
      late: count,
      absent: count,
      no_reply: count,
    }),
  ),
});

let owner: TestUser;
let workspaceId: string;

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Owner Person" });
  workspaceId = (await createWorkspaceAs(owner, "Robotics Club")).id;
});

async function insights(
  options: { from?: string; to?: string; client?: TestUser["client"] } = {},
) {
  const { data, error } = await (options.client ?? owner.client).rpc(
    "workspace_insights",
    {
      p_workspace: workspaceId,
      p_from: sqlNullable(options.from),
      p_to: sqlNullable(options.to),
    },
  );
  if (error) {
    throw error;
  }
  return insightsSchema.parse(data);
}

async function summary(options: { from?: string; to?: string } = {}) {
  const { data, error } = await owner.client.rpc("attendance_summary", {
    p_workspace: workspaceId,
    p_from: sqlNullable(options.from),
    p_to: sqlNullable(options.to),
  });
  if (error) {
    throw error;
  }
  return summarySchema.parse(data);
}

/** A meeting that started `hoursAgo` hours ago (scheduled, attendance mode unless overridden). */
const pastMeeting = (
  hoursAgo: number,
  overrides: Parameters<typeof seedMeeting>[1] = {},
) =>
  seedMeeting(workspaceId, {
    status: "scheduled",
    starts_at: hoursFromNow(-hoursAgo),
    ...overrides,
  });

const person = (fullName: string, isAdhoc = false) =>
  seedContact(workspaceId, `${crypto.randomUUID()}@example.test`, {
    fullName,
    isAdhoc,
  });

/** Invites contacts in one insert; returns their invitee ids in the same order. */
async function invite(
  meetingId: string,
  contactIds: string[],
  emailStatus: EmailStatus = "sent",
): Promise<string[]> {
  const { data, error } = await adminClient()
    .from("meeting_invitees")
    .insert(
      contactIds.map((contactId) => ({
        workspace_id: workspaceId,
        meeting_id: meetingId,
        contact_id: contactId,
        email_status: emailStatus,
      })),
    )
    .select("id, contact_id");
  if (error) {
    throw error;
  }
  return contactIds.map(
    (contactId) => data.find((row) => row.contact_id === contactId)?.id ?? "",
  );
}

/** Answers for an invitee; `respondedHoursAgo` sets the first answer's time. */
async function answer(
  meetingId: string,
  inviteeId: string,
  status: Answer,
  respondedHoursAgo?: number,
): Promise<void> {
  await seedAnswer(workspaceId, meetingId, inviteeId, {
    status,
    delay_minutes: status === "late" ? 10 : null,
  });
  if (respondedHoursAgo !== undefined) {
    const { error } = await adminClient()
      .from("responses")
      .update({ responded_at: hoursFromNow(-respondedHoursAgo) })
      .eq("invitee_id", inviteeId);
    if (error) {
      throw error;
    }
  }
}

async function mark(
  meetingId: string,
  inviteeId: string,
  actual: "present" | "late" | "absent",
): Promise<void> {
  const { error } = await adminClient().from("attendance_marks").insert({
    invitee_id: inviteeId,
    workspace_id: workspaceId,
    meeting_id: meetingId,
    actual,
  });
  if (error) {
    throw error;
  }
}

describe("workspace_insights (Home, spec §3.1)", () => {
  it("counts only started, scheduled, non-announcement meetings in the period", async () => {
    const [someone] = await seedContacts(workspaceId, 1);
    const counted = await pastMeeting(2);
    const ignored = await Promise.all([
      pastMeeting(3, { status: "draft" }),
      pastMeeting(3, { status: "cancelled" }),
      pastMeeting(3, { response_mode: "announcement" }),
      seedMeeting(workspaceId, {
        status: "scheduled",
        starts_at: hoursFromNow(24),
      }),
      pastMeeting(500),
    ]);
    for (const meetingId of [counted, ...ignored]) {
      await invite(meetingId, [someone]);
    }

    const result = await insights({ from: hoursFromNow(-100) });

    expect(result.period.meetings).toBe(1);
    expect(result.chart.map((entry) => entry.id)).toEqual([counted]);
    expect(result.chart[0]).toMatchObject({ no_reply: 1 });
  });

  it("uses the check-in where there is one, else the answer", async () => {
    const meetingId = await pastMeeting(2);
    const [markedAbsent, answeredLate, markedPresent] = await invite(
      meetingId,
      await seedContacts(workspaceId, 3),
    );
    await answer(meetingId, markedAbsent, "attending");
    await mark(meetingId, markedAbsent, "absent");
    await answer(meetingId, answeredLate, "late");
    await mark(meetingId, markedPresent, "present");

    const [entry] = (await insights()).chart;

    expect(entry).toMatchObject({
      attending: 1,
      late: 1,
      absent: 1,
      no_reply: 0,
    });
  });

  it("counts no reply only for reachable invitees", async () => {
    const meetingId = await pastMeeting(2);
    const statuses: EmailStatus[] = [
      "sent",
      "unknown",
      "skipped",
      "failed",
      "queued",
    ];
    const contacts = await seedContacts(workspaceId, statuses.length);
    for (const [index, emailStatus] of statuses.entries()) {
      await invite(meetingId, [contacts[index]], emailStatus);
    }

    const [entry] = (await insights()).chart;

    expect(entry.no_reply).toBe(2);
  });

  it("answered before the start uses the first answer", async () => {
    const meetingId = await pastMeeting(2);
    const [before, after] = await invite(
      meetingId,
      await seedContacts(workspaceId, 2, "reachable"),
    );
    const [unreachable] = await invite(
      meetingId,
      await seedContacts(workspaceId, 1, "unreachable"),
      "failed",
    );
    await answer(meetingId, before, "attending", 3);
    await answer(meetingId, after, "attending", 1);
    await answer(meetingId, unreachable, "attending", 3);
    // A change after the start keeps the first answer's time.
    const { error } = await adminClient()
      .from("responses")
      .update({ status: "absent", updated_at: hoursFromNow(-1) })
      .eq("invitee_id", before);
    expect(error).toBeNull();

    expect((await insights()).period.answered_before_start).toBe(0.5);

    const older = await pastMeeting(300);
    await invite(
      older,
      await seedContacts(workspaceId, 1, "skipped"),
      "skipped",
    );
    const nobodyReachable = await insights({ to: hoursFromNow(-200) });
    expect(nobodyReachable.period.meetings).toBe(1);
    expect(nobodyReachable.period.answered_before_start).toBeNull();
  });

  it("averages came and invited over the counted meetings", async () => {
    const first = await pastMeeting(4);
    const second = await pastMeeting(3);
    const firstInvitees = await invite(
      first,
      await seedContacts(workspaceId, 10, "first"),
    );
    const secondInvitees = await invite(
      second,
      await seedContacts(workspaceId, 10, "second"),
    );
    for (const inviteeId of firstInvitees.slice(0, 6)) {
      await answer(first, inviteeId, "attending");
    }
    for (const inviteeId of firstInvitees.slice(6, 8)) {
      await answer(first, inviteeId, "late");
    }
    for (const inviteeId of secondInvitees.slice(0, 4)) {
      await answer(second, inviteeId, "attending");
    }

    expect((await insights()).period).toMatchObject({
      meetings: 2,
      came_average: 6,
      invited_average: 10,
    });

    // A counted meeting nobody was invited to counts as 0 came, 0 invited.
    await pastMeeting(2);
    expect((await insights()).period).toMatchObject({
      meetings: 3,
      came_average: 4,
      invited_average: 6.7,
    });
  });

  it(`charts the newest ${INSIGHTS_CHART_MEETINGS} meetings, oldest first`, async () => {
    const ids: string[] = [];
    for (
      let hoursAgo = INSIGHTS_CHART_MEETINGS + 2;
      hoursAgo >= 1;
      hoursAgo -= 1
    ) {
      ids.push(await pastMeeting(hoursAgo, { title: `Meeting ${hoursAgo}` }));
    }

    const result = await insights();

    expect(result.period.meetings).toBe(INSIGHTS_CHART_MEETINGS + 2);
    expect(result.chart.map((entry) => entry.id)).toEqual(ids.slice(2));
    expect(result.chart[0]).toMatchObject({
      title: `Meeting ${INSIGHTS_CHART_MEETINGS}`,
      timezone: "Africa/Tunis",
    });
  });

  it(`lists up to ${OFTEN_MISSING_PEOPLE} roster members who missed the most; ties by absent, then name`, async () => {
    const meetings: string[] = [];
    for (let hoursAgo = 5; hoursAgo >= 1; hoursAgo -= 1) {
      meetings.push(await pastMeeting(hoursAgo));
    }
    const zara = await person("Zara Ben Ali");
    const yusuf = await person("Yusuf Haddad");
    const alpha = await person("alpha Member");
    const beta = await person("Beta Member");
    const adhoc = await person("Guest Speaker", true);
    // Per meeting (M1..M5): A = absent, - = no answer, G = attending.
    const plan: [string, string][] = [
      [zara, "AAA-G"],
      [yusuf, "AA--G"],
      [alpha, "AAAGG"],
      [beta, "AAAGG"],
      [adhoc, "-----"],
    ];
    for (const [index, meetingId] of meetings.entries()) {
      const invitees = await invite(
        meetingId,
        plan.map(([contactId]) => contactId),
      );
      for (const [row, [, outcomes]] of plan.entries()) {
        const outcome = outcomes[index];
        if (outcome !== "-") {
          await answer(
            meetingId,
            invitees[row],
            outcome === "A" ? "absent" : "attending",
          );
        }
      }
    }

    const result = await insights();

    // One candidate more than the list holds (the adhoc guest missed the most but never counts).
    expect(result.often_missing).toEqual(
      [
        {
          contact_id: zara,
          full_name: "Zara Ben Ali",
          invited: 5,
          missed: 4,
          absent: 3,
          no_reply: 1,
        },
        {
          contact_id: yusuf,
          full_name: "Yusuf Haddad",
          invited: 5,
          missed: 4,
          absent: 2,
          no_reply: 2,
        },
        {
          contact_id: alpha,
          full_name: "alpha Member",
          invited: 5,
          missed: 3,
          absent: 3,
          no_reply: 0,
        },
        {
          contact_id: beta,
          full_name: "Beta Member",
          invited: 5,
          missed: 3,
          absent: 3,
          no_reply: 0,
        },
      ].slice(0, OFTEN_MISSING_PEOPLE),
    );

    // Someone who missed nothing is never listed, even with room left.
    const older = await pastMeeting(500);
    const [cameId, missedId] = await Promise.all([
      person("Came Always"),
      person("Missed Once"),
    ]);
    const [came, missed] = await invite(older, [cameId, missedId]);
    await answer(older, came, "attending");
    await answer(older, missed, "not_attending");
    const oldPeriod = await insights({ to: hoursFromNow(-400) });
    expect(oldPeriod.often_missing).toEqual([
      {
        contact_id: missedId,
        full_name: "Missed Once",
        invited: 1,
        missed: 1,
        absent: 1,
        no_reply: 0,
      },
    ]);
  });

  it("matches attendance_summary for the same period", async () => {
    const contacts = await seedContacts(workspaceId, 6, "twin");
    const meetingIds = [
      await pastMeeting(30),
      await pastMeeting(20, { response_mode: "rsvp" }),
      await pastMeeting(10),
      await pastMeeting(200),
    ];
    const outcomes: (Answer | null)[] = [
      "attending",
      "late",
      "absent",
      "not_attending",
      null,
      null,
    ];
    for (const [m, meetingId] of meetingIds.entries()) {
      const invitees = await invite(meetingId, contacts.slice(0, 5));
      const [unreachable] = await invite(
        meetingId,
        contacts.slice(5),
        "failed",
      );
      for (const [index, inviteeId] of invitees.entries()) {
        const status = outcomes[(index + m) % outcomes.length];
        if (status) {
          await answer(meetingId, inviteeId, status);
        }
      }
      await mark(meetingId, invitees[m % invitees.length], "present");
      await mark(meetingId, unreachable, "absent");
    }
    const period = { from: hoursFromNow(-100) };

    const result = await insights(period);
    const twin = await summary(period);

    expect(result.period.meetings).toBe(twin.meetings);
    expect(result.often_missing.length).toBeGreaterThan(0);
    for (const row of result.often_missing) {
      const same = twin.rows.find(
        (entry) => entry.contact_id === row.contact_id,
      );
      expect(same).toMatchObject({
        invited: row.invited,
        absent: row.absent,
        no_reply: row.no_reply,
      });
    }
    const total = (
      rows: {
        attending: number;
        late: number;
        absent: number;
        no_reply: number;
      }[],
      key: "attending" | "late" | "absent" | "no_reply",
    ) => rows.reduce((sum, row) => sum + row[key], 0);
    for (const key of ["attending", "late", "absent", "no_reply"] as const) {
      expect(total(result.chart, key), key).toBe(total(twin.rows, key));
    }
  });

  it("counts the meetings held ever, whatever the period", async () => {
    await pastMeeting(500);
    await pastMeeting(2);
    await pastMeeting(3, { status: "cancelled" });
    await pastMeeting(3, { response_mode: "announcement" });
    await seedMeeting(workspaceId, {
      status: "scheduled",
      starts_at: hoursFromNow(24),
    });

    const recent = await insights({ from: hoursFromNow(-100) });
    expect(recent.held).toBe(2);
    expect(recent.period.meetings).toBe(1);

    const quiet = await insights({ to: hoursFromNow(-1000) });
    expect(quiet.held).toBe(2);
    expect(quiet.period.meetings).toBe(0);
  });

  it("counts roster members, lists, and committee (admins, viewers, pending invites)", async () => {
    await seedContacts(workspaceId, 3);
    await person("Guest Speaker", true);
    await seedList(workspaceId, "Robotics team");
    await seedList(workspaceId, "Mentors");
    const [admin, viewer] = await Promise.all([
      createTestUser(),
      createTestUser(),
    ]);
    await addMember(workspaceId, admin.id, "admin");
    await addMember(workspaceId, viewer.id, "viewer");
    await createInviteAs(owner, workspaceId, "pending@example.test", "viewer");
    const closed = {
      expired: { expires_at: hoursFromNow(-1) },
      revoked: { revoked_at: hoursFromNow(-1) },
      accepted: { accepted_at: hoursFromNow(-1) },
    };
    for (const [state, change] of Object.entries(closed)) {
      const email = `${state}@example.test`;
      await createInviteAs(owner, workspaceId, email, "admin");
      const { error } = await adminClient()
        .from("workspace_invites")
        .update(change)
        .eq("workspace_id", workspaceId)
        .eq("email", email);
      expect(error).toBeNull();
    }

    expect((await insights()).roster).toEqual({
      members: 3,
      lists: 2,
      committee: 3,
    });
  });

  it("lets members and viewers read it, and refuses others", async () => {
    const [viewer, stranger] = await Promise.all([
      createTestUser(),
      createTestUser(),
    ]);
    await addMember(workspaceId, viewer.id, "viewer");

    expect(await insights({ client: viewer.client })).toMatchObject({
      held: 0,
      period: { meetings: 0 },
    });
    await expectAppError(
      stranger.client.rpc("workspace_insights", { p_workspace: workspaceId }),
      "forbidden",
    );
    const { error } = await anonClient().rpc("workspace_insights", {
      p_workspace: workspaceId,
    });
    expect(error?.code).toBe("42501");
  });
});

describe("answers and check-ins stay with their invitee's meeting (#417)", () => {
  it("refuses an answer or a check-in filed under another meeting", async () => {
    const meetingId = await pastMeeting(3);
    const otherMeeting = await pastMeeting(2);
    const [inviteeId] = await invite(
      meetingId,
      await seedContacts(workspaceId, 1, "reachable"),
    );
    const admin = adminClient();
    const elsewhere = {
      workspace_id: workspaceId,
      meeting_id: otherMeeting,
      invitee_id: inviteeId,
    };
    expect(
      (
        await admin
          .from("responses")
          .insert({ ...elsewhere, status: "attending" })
      ).error?.code,
    ).toBe("23503");
    expect(
      (
        await admin
          .from("attendance_marks")
          .insert({ ...elsewhere, actual: "present" })
      ).error?.code,
    ).toBe("23503");

    // Filed under the right meeting, neither can move to another one.
    await answer(meetingId, inviteeId, "attending");
    await mark(meetingId, inviteeId, "present");
    expect(
      (
        await admin
          .from("responses")
          .update({ meeting_id: otherMeeting })
          .eq("invitee_id", inviteeId)
      ).error?.code,
    ).toBe("23503");
    expect(
      (
        await admin
          .from("attendance_marks")
          .update({ meeting_id: otherMeeting })
          .eq("invitee_id", inviteeId)
      ).error?.code,
    ).toBe("23503");
  });
});
