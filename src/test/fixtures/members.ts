import type { Member } from "@/shared/api/members";

/** Ids shared by settings tests (the Owner is `meFixture.userId`). */
export const ownerId = "0a0a0a0a-0000-4000-8000-000000000001";
export const adminId = "0a0a0a0a-0000-4000-8000-000000000002";
export const viewerId = "0a0a0a0a-0000-4000-8000-000000000003";

const member = (
  userId: string,
  role: Member["role"],
  displayName: string,
): Member => ({
  userId,
  role,
  canCheckIn: false,
  displayName,
  avatarUrl: null,
  email: `${displayName.split(" ")[0].toLowerCase()}@example.test`,
  joinedAt: "2026-10-05T00:00:00Z",
});

/** Owner (me), one Admin, one Viewer. */
export const membersFixture: Member[] = [
  member(ownerId, "owner", "Owner Person"),
  member(adminId, "admin", "Admin Person"),
  member(viewerId, "viewer", "Viewer Person"),
];
