import type { MeResponse } from "@/shared/api/me";
import type { WorkspaceDetails } from "@/shared/api/workspaces";

/** A signed-in Owner with two workspaces. */
export const meFixture: MeResponse = {
  userId: "0a0a0a0a-0000-4000-8000-000000000001",
  profile: {
    displayName: "Amira Ben Ali",
    avatarUrl: null,
    email: "amira@example.test",
  },
  workspaces: [
    {
      id: "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
      slug: "chess-ab12",
      name: "Chess Club",
      role: "viewer",
    },
    {
      id: "0b1f6a3e-5d0a-4a0e-9a49-3e2d0f5b9c11",
      slug: "robotics-cd34",
      name: "Robotics Club",
      role: "owner",
    },
  ],
  lastWorkspaceSlug: "robotics-cd34",
};

/** Robotics Club as seen by its Owner. */
export const workspaceFixture: WorkspaceDetails = {
  id: "0b1f6a3e-5d0a-4a0e-9a49-3e2d0f5b9c11",
  slug: "robotics-cd34",
  name: "Robotics Club",
  timezone: "Africa/Tunis",
  myRole: "owner",
  canCheckIn: false,
};
