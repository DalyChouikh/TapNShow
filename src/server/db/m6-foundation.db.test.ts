import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  adminClient,
  createTestUser,
  expectAppError,
  type TestUser,
} from "@/test/db/clients";
import { seedMeeting } from "@/test/db/meetings";
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
let contact: string;

const hoursFromNow = (hours: number) =>
  new Date(Date.now() + hours * 3600_000).toISOString();

async function sendTo(meeting: string, contactIds: string[]) {
  const audience = await owner.client.rpc("set_meeting_audience", {
    p_meeting: meeting,
    p_list_ids: [],
    p_include: contactIds,
    p_exclude: [],
  });
  if (audience.error) throw audience.error;
  return owner.client.rpc("send_meeting", { p_meeting: meeting });
}

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Owner" });
  workspace = await createWorkspaceAs(owner, "M6 Club");
  await setSender(workspace.id, await seedConnection(owner.id));
  [contact] = await seedContacts(
    workspace.id,
    1,
    `m6-${crypto.randomUUID().slice(0, 6)}`,
  );
});

describe("response_deadline_problem", () => {
  const problem = (deadline: string | null, start: string | null) =>
    queryLocalSql(
      `select private.response_deadline_problem(${deadline ? `'${deadline}'` : "null"}, ${start ? `'${start}'` : "null"}) as p`,
      z.array(z.object({ p: z.string().nullable() })),
    )[0].p;

  it("accepts a deadline later the same day, before the start", () => {
    expect(problem(hoursFromNow(1), hoursFromNow(2))).toBeNull();
  });
  it("refuses a deadline at or after the start, and one in the past", () => {
    const start = hoursFromNow(2);
    expect(problem(start, start)).toBe("deadline_after_start");
    expect(problem(hoursFromNow(3), start)).toBe("deadline_after_start");
    expect(problem(hoursFromNow(-1), start)).toBe("deadline_in_past");
  });
  it("has nothing to say without a deadline", () => {
    expect(problem(null, hoursFromNow(2))).toBeNull();
  });
});

describe("send_meeting (M6)", () => {
  it("refuses a first send whose deadline is at the start, with the deadline code", async () => {
    const start = hoursFromNow(5);
    const meeting = await seedMeeting(workspace.id, {
      starts_at: start,
      response_deadline: start,
    });
    await expectAppError(sendTo(meeting, [contact]), "deadline_after_start");
  });

  it("lets Invite more go out after the deadline has passed", async () => {
    const meeting = await seedMeeting(workspace.id, {
      starts_at: hoursFromNow(5),
      response_deadline: hoursFromNow(1),
    });
    const first = await sendTo(meeting, [contact]);
    expect(first.error).toBeNull();
    await adminClient()
      .from("meetings")
      .update({ response_deadline: hoursFromNow(-1) })
      .eq("id", meeting);
    const [later] = await seedContacts(
      workspace.id,
      1,
      `late-${crypto.randomUUID().slice(0, 6)}`,
    );
    const more = await sendTo(meeting, [contact, later]);
    expect(more.error).toBeNull();
  });
});

describe("create_meeting copies the reminder defaults", () => {
  it("uses the workspace's defaults (24 h and 2 h unless changed)", async () => {
    await adminClient()
      .from("workspaces")
      .update({ default_reminder_going_hours: null })
      .eq("id", workspace.id);
    const { data: id } = await owner.client.rpc("create_meeting", {
      p_workspace: workspace.id,
    });
    const { data } = await adminClient()
      .from("meetings")
      .select("reminder_pending_hours, reminder_going_hours")
      .eq("id", id ?? "")
      .single();
    expect(data).toEqual({
      reminder_pending_hours: 24,
      reminder_going_hours: null,
    });
  });
});

describe("meeting_changes and attendance_marks access", () => {
  it("lets members read and nobody write directly", async () => {
    const viewer = await createTestUser();
    await addMember(workspace.id, viewer.id, "viewer");
    const meeting = await seedMeeting(workspace.id, { status: "scheduled" });
    await adminClient().from("meeting_changes").insert({
      workspace_id: workspace.id,
      meeting_id: meeting,
      kind: "edit",
      changes: {},
      notified: false,
    });
    expect(
      (
        await viewer.client
          .from("meeting_changes")
          .select("id")
          .eq("meeting_id", meeting)
      ).data,
    ).toHaveLength(1);
    const write = await owner.client.from("meeting_changes").insert({
      workspace_id: workspace.id,
      meeting_id: meeting,
      kind: "edit",
      changes: {},
      notified: false,
    });
    expect(write.error?.code).toBe("42501");
    const outsider = await createTestUser();
    expect(
      (
        await outsider.client
          .from("meeting_changes")
          .select("id")
          .eq("meeting_id", meeting)
      ).data,
    ).toEqual([]);
    const mark = await owner.client.from("attendance_marks").insert({
      invitee_id: crypto.randomUUID(),
      workspace_id: workspace.id,
      meeting_id: meeting,
      actual: "present",
    });
    expect(mark.error?.code).toBe("42501");
  });
});
