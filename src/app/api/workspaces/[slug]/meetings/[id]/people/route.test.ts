import { beforeEach, describe, expect, it, vi } from "vitest";
import { meetingFixture, MEETING_IDS } from "@/test/fixtures/meetings";
import { jsonRequest, okContext } from "@/test/workspace-context-mock";

const mocks = vi.hoisted(() => ({ context: { value: null as object | null } }));
vi.mock("@/server/http/meeting-context", () => ({
  loadMeetingContext: async () =>
    mocks.context.value ?? { ...okContext, meeting: meetingFixture },
}));
const ctx = {
  params: Promise.resolve({ slug: "club-ab12", id: MEETING_IDS.meeting }),
};

const queries = vi.hoisted(() => ({ addPeople: vi.fn() }));
vi.mock("@/server/queries/meetings", () => queries);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.value = null;
});

describe("POST …/meetings/[id]/people", () => {
  it("normalizes the people and forwards them", async () => {
    queries.addPeople.mockResolvedValueOnce({
      data: [MEETING_IDS.amira],
      error: null,
    });
    const { POST } = await import("./route");
    const response = await POST(
      jsonRequest("POST", {
        people: [{ fullName: " Nour ", email: " Nour@Uni.TN " }],
        saveToRoster: false,
      }),
      ctx,
    );
    expect(await response.json()).toEqual({ contactIds: [MEETING_IDS.amira] });
    expect(queries.addPeople).toHaveBeenCalledWith({}, MEETING_IDS.meeting, {
      people: [{ fullName: "Nour", email: "nour@uni.tn" }],
      saveToRoster: false,
    });
  });

  it("refuses 51 rows and names the contacts cap", async () => {
    const { POST } = await import("./route");
    const many = Array.from({ length: 51 }, (_, n) => ({
      fullName: `P${n}`,
      email: `p${n}@x.test`,
    }));
    expect(
      (
        await POST(
          jsonRequest("POST", { people: many, saveToRoster: true }),
          ctx,
        )
      ).status,
    ).toBe(400);
    expect(queries.addPeople).not.toHaveBeenCalled();
    queries.addPeople.mockResolvedValueOnce({
      data: null,
      error: { code: "P0001", message: "tn:contacts_limit_reached" },
    });
    const capped = await POST(
      jsonRequest("POST", {
        people: [{ fullName: "Nour", email: "nour@uni.tn" }],
        saveToRoster: true,
      }),
      ctx,
    );
    expect(capped.status).toBe(409);
    expect(await capped.json()).toEqual({
      error: { code: "contacts_limit_reached" },
    });
  });
});
