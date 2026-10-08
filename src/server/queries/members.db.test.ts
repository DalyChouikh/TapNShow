import { describe, expect, it } from "vitest";
import { createTestUser } from "@/test/db/clients";
import { addMember, createWorkspaceAs } from "@/test/db/workspaces";
import {
  changeRole,
  deleteWorkspace,
  leaveWorkspace,
  listMembersPage,
  removeMember,
  transferOwnership,
} from "./members";
import { updateWorkspace } from "./workspaces";

const listMembers = async (
  client: Parameters<typeof listMembersPage>[0],
  workspaceId: string,
) =>
  (await listMembersPage(client, workspaceId, null, 50, null)).data?.items ??
  [];

describe("member queries", () => {
  it("lists members in camelCase and applies role changes", async () => {
    const owner = await createTestUser({ fullName: "Owner" });
    const viewer = await createTestUser({ fullName: "Viewer" });
    const workspace = await createWorkspaceAs(owner, "Photo Club");
    await addMember(workspace.id, viewer.id, "viewer");
    const members = await listMembers(owner.client, workspace.id);
    expect(members.map((member) => [member.displayName, member.role])).toEqual([
      ["Owner", "owner"],
      ["Viewer", "viewer"],
    ]);
    expect(
      (
        await changeRole(owner.client, {
          workspaceId: workspace.id,
          userId: viewer.id,
          role: "viewer",
          canCheckIn: true,
        })
      ).error,
    ).toBeNull();
    expect(
      (await listMembers(owner.client, workspace.id)).find(
        (member) => member.userId === viewer.id,
      )?.canCheckIn,
    ).toBe(true);
  });

  it("updates, transfers, removes, leaves and deletes through the database rules", async () => {
    const owner = await createTestUser();
    const admin = await createTestUser();
    const viewer = await createTestUser();
    const workspace = await createWorkspaceAs(owner, "Film Club");
    await addMember(workspace.id, admin.id, "admin");
    await addMember(workspace.id, viewer.id, "viewer");
    expect(
      (
        await updateWorkspace(owner.client, workspace.id, {
          name: "Cinema Club",
        })
      ).error,
    ).toBeNull();
    expect(
      (await updateWorkspace(viewer.client, workspace.id, { name: "Nope" }))
        .error?.message,
    ).toBe("tn:forbidden");
    expect(
      (
        await transferOwnership(owner.client, {
          workspaceId: workspace.id,
          userId: admin.id,
          confirmName: "Cinema Club",
        })
      ).error,
    ).toBeNull();
    expect(
      (await removeMember(admin.client, workspace.id, viewer.id)).error,
    ).toBeNull();
    expect((await leaveWorkspace(owner.client, workspace.id)).error).toBeNull();
    expect(
      (await deleteWorkspace(admin.client, workspace.id, "Cinema Club")).error,
    ).toBeNull();
  });
});
