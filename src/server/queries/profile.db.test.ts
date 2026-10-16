import { describe, expect, it } from "vitest";
import { createTestUser } from "@/test/db/clients";
import { makePlatformAdmin } from "@/test/db/platform";
import { addMember, createWorkspaceAs } from "@/test/db/workspaces";
import { getMe, updateProfile } from "./profile";

describe("getMe", () => {
  it("returns profile, memberships sorted by name, and the last workspace slug", async () => {
    const user = await createTestUser({ fullName: "Sami" });
    const other = await createTestUser();
    const zeta = await createWorkspaceAs(user, "Zeta Club");
    const alpha = await createWorkspaceAs(other, "Alpha Club");
    await addMember(alpha.id, user.id, "viewer");
    const me = await getMe(user.client, { id: user.id, email: user.email });
    expect(me.userId).toBe(user.id);
    expect(me.profile).toEqual({
      displayName: "Sami",
      avatarUrl: null,
      email: user.email,
    });
    expect(
      me.workspaces.map((workspace) => [workspace.name, workspace.role]),
    ).toEqual([
      ["Alpha Club", "viewer"],
      ["Zeta Club", "owner"],
    ]);
    expect(me.lastWorkspaceSlug).toBe(zeta.slug);
  });
});

describe("getMe platformRole", () => {
  it("is the platform role of an admin, and null for everyone else", async () => {
    const admin = await createTestUser();
    const member = await createTestUser();
    makePlatformAdmin(admin);
    expect(
      (await getMe(admin.client, { id: admin.id, email: admin.email }))
        .platformRole,
    ).toBe("admin");
    expect(
      (await getMe(member.client, { id: member.id, email: member.email }))
        .platformRole,
    ).toBeNull();
  });
});

describe("updateProfile", () => {
  it("trims the name and refuses foreign workspaces", async () => {
    const user = await createTestUser();
    const stranger = await createTestUser();
    const foreign = await createWorkspaceAs(stranger);
    expect(
      (await updateProfile(user.client, user.id, { displayName: "Lina" }))
        .error,
    ).toBeNull();
    expect(
      (await getMe(user.client, { id: user.id, email: user.email })).profile
        .displayName,
    ).toBe("Lina");
    expect(
      (
        await updateProfile(user.client, user.id, {
          lastWorkspaceId: foreign.id,
        })
      ).error?.code,
    ).toBe("42501");
  });
});
