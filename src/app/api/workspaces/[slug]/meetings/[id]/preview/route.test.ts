import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  audienceFixture,
  meetingFixture,
  MEETING_IDS,
} from "@/test/fixtures/meetings";
import { jsonRequest, okContext } from "@/test/workspace-context-mock";

const mocks = vi.hoisted(() => ({ context: { value: null as object | null } }));
vi.mock("@/server/http/meeting-context", () => ({
  loadMeetingContext: async () =>
    mocks.context.value ?? { ...okContext, meeting: meetingFixture },
}));
const ctx = {
  params: Promise.resolve({ slug: "club-ab12", id: MEETING_IDS.meeting }),
};

const queries = vi.hoisted(() => ({
  getAudience: vi.fn(),
  getWorkspaceSender: vi.fn(),
}));
vi.mock("@/server/queries/meetings", () => ({
  getAudience: queries.getAudience,
}));
vi.mock("@/server/queries/sender", () => ({
  getWorkspaceSender: queries.getWorkspaceSender,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.value = null;
  queries.getAudience.mockResolvedValue({ data: audienceFixture, error: null });
});

describe("GET …/meetings/[id]/preview", () => {
  it("renders the invite for the first person to invite, with inert links", async () => {
    queries.getWorkspaceSender.mockResolvedValue({
      data: {
        sender: { email: "club@gmail.com" },
        ownerName: "Daly",
        myConnections: [],
      },
      error: null,
    });
    const { GET } = await import("./route");
    const preview = await (await GET(jsonRequest("GET"), ctx)).json();
    expect(preview).toMatchObject({
      subject: "Weekly sync · Fri 9 Oct, 18:00",
      fromName: "Robotics Club",
      fromEmail: "club@gmail.com",
      recipientName: "Amira B.",
    });
    expect(preview.html).toContain('href="#?choice=attending"');
    expect(preview.html).not.toContain("/r/");
  });

  it("works without a sender", async () => {
    queries.getWorkspaceSender.mockResolvedValue({
      data: { sender: null, ownerName: "Daly", myConnections: [] },
      error: null,
    });
    const { GET } = await import("./route");
    expect(
      (await (await GET(jsonRequest("GET"), ctx)).json()).fromEmail,
    ).toBeNull();
  });
});
