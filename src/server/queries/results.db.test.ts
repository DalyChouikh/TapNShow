import { describe, expect, it } from "vitest";
import { workspaceInsightsSchema } from "@/shared/api/insights";
import { createTestUser } from "@/test/db/clients";
import { seedInvitee } from "@/test/db/invitees";
import { hoursFromNow, seedMeeting } from "@/test/db/meetings";
import { seedContacts } from "@/test/db/roster";
import { createWorkspaceAs } from "@/test/db/workspaces";
import { getWorkspaceInsights } from "./results";

const ALL_TIME = { from: null, to: null };

describe("getWorkspaceInsights", () => {
  it("returns Home's insights in camelCase, valid for the shared schema", async () => {
    const owner = await createTestUser();
    const workspace = await createWorkspaceAs(owner, "Robotics Club");
    const [contactId] = await seedContacts(workspace.id, 1);
    const startsAt = hoursFromNow(-2);
    const meetingId = await seedMeeting(workspace.id, {
      status: "scheduled",
      starts_at: startsAt,
      title: "Weekly sync",
    });
    await seedInvitee(workspace.id, meetingId, contactId);

    const { data, error } = await getWorkspaceInsights(
      owner.client,
      workspace.id,
      ALL_TIME,
    );

    expect(error).toBeNull();
    const insights = workspaceInsightsSchema.parse(data);
    expect(insights).toEqual({
      roster: { members: 1, lists: 0, committee: 0 },
      period: {
        meetings: 1,
        cameAverage: 0,
        invitedAverage: 1,
        answeredBeforeStart: 0,
      },
      chart: [
        {
          id: meetingId,
          title: "Weekly sync",
          startsAt: insights.chart[0].startsAt,
          timezone: "Africa/Tunis",
          attending: 0,
          late: 0,
          absent: 0,
          noReply: 1,
        },
      ],
      oftenMissing: [
        {
          contactId,
          fullName: "member 1",
          invited: 1,
          missed: 1,
          absent: 0,
          noReply: 1,
        },
      ],
    });
    expect(new Date(insights.chart[0].startsAt).getTime()).toBe(
      new Date(startsAt).getTime(),
    );
  });

  it("returns the refusal for someone outside the workspace", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    const workspace = await createWorkspaceAs(owner, "Robotics Club");

    const { data, error } = await getWorkspaceInsights(
      stranger.client,
      workspace.id,
      ALL_TIME,
    );

    expect(data).toBeNull();
    expect(error?.message).toBe("tn:forbidden");
  });
});
