import type { TestUser } from "./clients";
import { adminClient } from "./clients";

/** Workspace fields tests need. */
export type TestWorkspace = { id: string; slug: string; name: string };

/** Creates a workspace through `create_workspace`, owned by `user`. */
export async function createWorkspaceAs(
  user: TestUser,
  name = "Test Club",
): Promise<TestWorkspace> {
  const slug = `test-${crypto.randomUUID().slice(0, 8)}`;
  const { data, error } = await user.client.rpc("create_workspace", {
    p_name: name,
    p_slug: slug,
    p_timezone: "Africa/Tunis",
  });
  if (error || !data) {
    throw error ?? new Error("create_workspace returned nothing");
  }
  return { id: data.id, slug: data.slug, name: data.name };
}

/** Adds a member directly (service role), bypassing the membership functions. */
export async function addMember(
  workspaceId: string,
  userId: string,
  role: "owner" | "admin" | "viewer",
  canCheckIn = false,
): Promise<void> {
  const { error } = await adminClient().from("workspace_roles").insert({
    workspace_id: workspaceId,
    user_id: userId,
    role,
    can_check_in: canCheckIn,
  });
  if (error) {
    throw error;
  }
}
