import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { fittingDelays, lateMinutesMax } from "@/lib/meetings/late";
import { fromDatabaseError } from "@/server/http/errors";
import { updateMeeting } from "@/server/queries/meetings";
import { updateMeetingDefaults } from "@/server/queries/sender";
import { API_ERROR_STATUS } from "@/shared/api/errors";
import {
  adminClient,
  createTestUser,
  expectAppError,
  type TestUser,
} from "@/test/db/clients";
import { seedInvitee } from "@/test/db/invitees";
import { hoursFromNow, seedMeeting } from "@/test/db/meetings";
import { seedContacts } from "@/test/db/roster";
import { queryLocalSql } from "@/test/db/sql";
import { createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";

let owner: TestUser;
let workspace: TestWorkspace;

beforeAll(async () => {
  owner = await createTestUser();
  workspace = await createWorkspaceAs(owner, "Riverside Volunteers");
});

/** What the API answers for a database error (status and code). */
async function apiAnswer(error: { code?: string; message: string } | null) {
  expect(error).not.toBeNull();
  const response = fromDatabaseError(error ?? { message: "" });
  const body = z
    .object({ error: z.object({ code: z.string() }) })
    .parse(await response.json());
  return { status: response.status, code: body.error.code };
}

const LATE_TOO_LONG = {
  status: API_ERROR_STATUS.late_too_long,
  code: "late_too_long",
};

describe("the rule's SQL twins", () => {
  it("late_minutes_max matches lateMinutesMax at every boundary", () => {
    const durations = [5, 6, 30, 31, 239, 240, 241, 242, 720];
    const rows = queryLocalSql(
      `select d as duration, private.late_minutes_max(d) as max
       from unnest(array[${durations.join(",")}]) d`,
      z.array(z.object({ duration: z.number(), max: z.number() })),
    );
    expect(rows).toHaveLength(durations.length);
    for (const row of rows) {
      expect(row.max, `duration ${row.duration}`).toBe(
        lateMinutesMax(row.duration),
      );
    }
  });

  it("fitting_delays matches fittingDelays, order kept", () => {
    const cases: [number[], number][] = [
      [[5, 10, 15, 20, 30, 45], 30],
      [[30, 5, 15], 16],
      [[5, 30], 30],
      [[5, 10], 5],
      [[], 60],
      [[60, 240], 720],
    ];
    for (const [options, duration] of cases) {
      const [row] = queryLocalSql(
        `select coalesce(private.fitting_delays('{${options.join(",")}}'::smallint[], ${duration}),
           '{}') as fit`,
        z.array(z.object({ fit: z.array(z.number()) })).length(1),
      );
      expect(row.fit, `${options} in ${duration} min`).toEqual(
        fittingDelays(options, duration),
      );
    }
  });
});

describe("a draft's late choices", () => {
  it("refuses a length that a late choice isn't shorter than, as late_too_long", async () => {
    const draft = await seedMeeting(workspace.id);
    const { error } = await updateMeeting(owner.client, workspace.id, draft, {
      durationMinutes: 30,
    });
    expect(await apiAnswer(error)).toEqual(LATE_TOO_LONG);
  });

  it("refuses a late choice as long as the meeting", async () => {
    const draft = await seedMeeting(workspace.id);
    const { error } = await updateMeeting(owner.client, workspace.id, draft, {
      delayOptions: [5, 60],
    });
    expect(await apiAnswer(error)).toEqual(LATE_TOO_LONG);
  });

  it("saves a shorter length with the late choices that fit, in one write", async () => {
    const draft = await seedMeeting(workspace.id);
    const { data, error } = await updateMeeting(
      owner.client,
      workspace.id,
      draft,
      { durationMinutes: 30, delayOptions: [5, 10, 15, 29] },
    );
    expect(error).toBeNull();
    expect(data).toMatchObject({
      durationMinutes: 30,
      delayOptions: [5, 10, 15, 29],
    });
  });
});

describe("the workspace's default late choices", () => {
  it("refuses a default length the default choices don't fit, as late_too_long", async () => {
    const { error } = await updateMeetingDefaults(owner.client, workspace.id, {
      durationMinutes: 30,
    });
    expect(await apiAnswer(error)).toEqual(LATE_TOO_LONG);
  });

  it("saves the shorter default length with the choices that fit", async () => {
    const { error } = await updateMeetingDefaults(owner.client, workspace.id, {
      durationMinutes: 30,
      delayOptions: [5, 10, 15],
    });
    expect(error).toBeNull();
    const { data } = await adminClient()
      .from("workspaces")
      .select("default_duration_minutes, default_delay_options")
      .eq("id", workspace.id)
      .single();
    expect(data).toEqual({
      default_duration_minutes: 30,
      default_delay_options: [5, 10, 15],
    });
  });
});

describe("a sent meeting", () => {
  const edit = (meeting: string, durationMinutes: number, dryRun: boolean) =>
    owner.client.rpc("edit_sent_meeting", {
      p_meeting: meeting,
      p_fields: { duration_minutes: durationMinutes },
      p_notify: false,
      p_dry_run: dryRun,
    });

  it("can't be made as short as its longest late choice, in the preview or the save", async () => {
    const meeting = await seedMeeting(workspace.id, { status: "scheduled" });
    await expectAppError(edit(meeting, 30, true), "late_too_long");
    await expectAppError(edit(meeting, 30, false), "late_too_long");
    const { data } = await adminClient()
      .from("meetings")
      .select("duration_minutes")
      .eq("id", meeting)
      .single();
    expect(data?.duration_minutes).toBe(60);
  });

  it("can be made shorter while every late choice still fits", async () => {
    const meeting = await seedMeeting(workspace.id, { status: "scheduled" });
    const { data, error } = await edit(meeting, 31, true);
    expect(error).toBeNull();
    expect(data).toMatchObject({ changed: true });
  });

  it("keeps a member's late answer as given when an edit is refused", async () => {
    const meeting = await seedMeeting(workspace.id, { status: "scheduled" });
    const [contact] = await seedContacts(
      workspace.id,
      1,
      `late-keep-${crypto.randomUUID().slice(0, 6)}`,
    );
    const { hash } = await seedInvitee(workspace.id, meeting, contact);
    const { error } = await adminClient().rpc("token_submit_response", {
      p_token_hash: hash,
      p_status: "late",
      p_delay_minutes: 30,
      p_reason: "Bus",
      p_comment: null,
    } as never);
    expect(error).toBeNull();
    await expectAppError(edit(meeting, 30, false), "late_too_long");
    const { data } = await adminClient()
      .from("responses")
      .select("status, delay_minutes")
      .eq("meeting_id", meeting)
      .single();
    expect(data).toEqual({ status: "late", delay_minutes: 30 });
  });
});

describe("a Late check-in", () => {
  async function startedMeeting() {
    const meeting = await seedMeeting(workspace.id, {
      status: "scheduled",
      starts_at: hoursFromNow(-0.25),
    });
    await adminClient()
      .from("meetings")
      .update({ duration_minutes: 30, delay_options: [5, 10] })
      .eq("id", meeting);
    const [contact] = await seedContacts(
      workspace.id,
      1,
      `late-mark-${crypto.randomUUID().slice(0, 6)}`,
    );
    const { inviteeId } = await seedInvitee(workspace.id, meeting, contact);
    return { meeting, inviteeId };
  }
  const mark = (meeting: string, inviteeId: string, lateMinutes: number) =>
    owner.client.rpc("mark_attendance", {
      p_meeting: meeting,
      p_invitee: inviteeId,
      p_actual: "late",
      p_late_minutes: lateMinutes,
    });

  it("records up to one minute shorter than the meeting", async () => {
    const { meeting, inviteeId } = await startedMeeting();
    const { error } = await mark(meeting, inviteeId, 29);
    expect(error).toBeNull();
  });

  it("refuses minutes as long as the meeting, as late_too_long", async () => {
    const { meeting, inviteeId } = await startedMeeting();
    await expectAppError(mark(meeting, inviteeId, 30), "late_too_long");
  });
});
