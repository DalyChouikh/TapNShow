import type { MyInvite } from "@/shared/api/my-invites";

/**
 * An unanswered Weekly sync of Robotics Club on Sun 18 Oct 2026, 18:00 Africa/Tunis (asks for answers,
 * no deadline).
 */
export const myInviteFixture: MyInvite = {
  inviteeId: "6a1f2b3c-4d5e-4f60-8a71-b2c3d4e5f6aa",
  workspaceName: "Robotics Club",
  title: "Weekly sync",
  startsAt: "2026-10-18T17:00:00.000Z",
  timezone: "Africa/Tunis",
  durationMinutes: 60,
  status: "scheduled",
  responseMode: "attendance",
  responseDeadline: null,
  needsAnswer: true,
  answer: null,
  mark: null,
};

/** A page of `GET /api/me/invites` around `items`. */
export function myInvitesPage(
  items: MyInvite[],
  over: { nextCursor?: string | null; needsCount?: number } = {},
) {
  return {
    items,
    nextCursor: over.nextCursor ?? null,
    needsCount:
      over.needsCount ?? items.filter((item) => item.needsAnswer).length,
    asOf: "2026-10-14T10:00:00.000Z",
  };
}
