import { beforeEach, describe, expect, it, vi } from "vitest";
import { meetingFixture, MEETING_IDS } from "@/test/fixtures/meetings";
import {
  jsonRequest,
  okContext,
  viewerContext,
} from "@/test/workspace-context-mock";

const mocks = vi.hoisted(() => ({ context: { value: null as object | null } }));
vi.mock("@/server/http/meeting-context", () => ({
  loadMeetingContext: async () =>
    mocks.context.value ?? { ...okContext, meeting: meetingFixture },
}));
const queries = vi.hoisted(() => ({ markAttendance: vi.fn() }));
vi.mock("@/server/queries/check-in", () => queries);

const ctx = {
  params: Promise.resolve({ slug: "club-ab12", id: MEETING_IDS.meeting }),
};
const body = { inviteeId: MEETING_IDS.invitee, actual: "absent" };
const mark = {
  actual: "absent",
  markedAt: "2026-10-09T17:05:00.000Z",
  markedByName: "Door Viewer",
  lateMinutes: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.value = null;
});

describe("PUT …/meetings/[id]/check-in", () => {
  it("lets a Viewer with check-in mark someone", async () => {
    mocks.context.value = {
      ...viewerContext,
      workspace: { ...viewerContext.workspace, canCheckIn: true },
      meeting: meetingFixture,
    };
    queries.markAttendance.mockResolvedValueOnce({ data: mark, error: null });
    const { PUT } = await import("./route");
    const response = await PUT(jsonRequest("PUT", body), ctx);
    expect(await response.json()).toEqual({ mark });
    expect(queries.markAttendance).toHaveBeenCalledWith(
      okContext.supabase,
      MEETING_IDS.meeting,
      MEETING_IDS.invitee,
      "absent",
      null,
    );
  });

  it("passes how late someone was, only with Late and within 1–240 minutes (#257)", async () => {
    const { PUT } = await import("./route");
    queries.markAttendance.mockResolvedValueOnce({ data: mark, error: null });
    const late = { inviteeId: MEETING_IDS.invitee, actual: "late" };
    await PUT(jsonRequest("PUT", { ...late, lateMinutes: 15 }), ctx);
    expect(queries.markAttendance).toHaveBeenCalledWith(
      okContext.supabase,
      MEETING_IDS.meeting,
      MEETING_IDS.invitee,
      "late",
      15,
    );
    for (const bad of [
      { ...body, lateMinutes: 10 },
      { ...late, lateMinutes: 0 },
      { ...late, lateMinutes: 241 },
      { ...late, lateMinutes: 2.5 },
    ]) {
      expect((await PUT(jsonRequest("PUT", bad), ctx)).status).toBe(400);
    }
    expect(queries.markAttendance).toHaveBeenCalledOnce();
  });

  it("refuses a plain Viewer, a bad body, and says when check-in is closed", async () => {
    const { PUT } = await import("./route");
    mocks.context.value = { ...viewerContext, meeting: meetingFixture };
    expect((await PUT(jsonRequest("PUT", body), ctx)).status).toBe(403);
    expect(queries.markAttendance).not.toHaveBeenCalled();
    mocks.context.value = null;
    expect(
      (await PUT(jsonRequest("PUT", { ...body, actual: "maybe" }), ctx)).status,
    ).toBe(400);
    queries.markAttendance.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:check_in_closed" },
    });
    expect((await PUT(jsonRequest("PUT", body), ctx)).status).toBe(409);
  });
});
