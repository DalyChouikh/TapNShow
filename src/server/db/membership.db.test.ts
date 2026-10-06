import { beforeEach, describe, expect, it } from "vitest";
import {
  createTestUser,
  expectAppError,
  type TestUser,
} from "@/test/db/clients";
import {
  addMember,
  createWorkspaceAs,
  type TestWorkspace,
} from "@/test/db/workspaces";

let owner: TestUser;
let admin: TestUser;
let viewer: TestUser;
let stranger: TestUser;
let workspace: TestWorkspace;

async function roleOf(user: TestUser): Promise<string | null> {
  const { data } = await owner.client
    .from("workspace_roles")
    .select("role")
    .eq("workspace_id", workspace.id)
    .eq("user_id", user.id)
    .maybeSingle();
  return data?.role ?? null;
}

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Owner" });
  admin = await createTestUser({ fullName: "Admin" });
  viewer = await createTestUser({ fullName: "Viewer" });
  stranger = await createTestUser();
  workspace = await createWorkspaceAs(owner, "Robotics Club");
  await addMember(workspace.id, admin.id, "admin");
  await addMember(workspace.id, viewer.id, "viewer");
});

describe("change_role", () => {
  it("lets Admins toggle a Viewer's check-in permission", async () => {
    const { error } = await admin.client.rpc("change_role", {
      p_workspace: workspace.id,
      p_user: viewer.id,
      p_role: "viewer",
      p_can_check_in: true,
    });
    expect(error).toBeNull();
    const { data } = await owner.client
      .from("workspace_roles")
      .select("can_check_in")
      .eq("user_id", viewer.id)
      .single();
    expect(data?.can_check_in).toBe(true);
  });

  it("lets only the Owner promote to or demote from Admin", async () => {
    await expectAppError(
      admin.client.rpc("change_role", {
        p_workspace: workspace.id,
        p_user: viewer.id,
        p_role: "admin",
        p_can_check_in: false,
      }),
      "forbidden",
    );
    await expectAppError(
      admin.client.rpc("change_role", {
        p_workspace: workspace.id,
        p_user: admin.id,
        p_role: "viewer",
        p_can_check_in: false,
      }),
      "forbidden",
    );
    await owner.client.rpc("change_role", {
      p_workspace: workspace.id,
      p_user: viewer.id,
      p_role: "admin",
      p_can_check_in: false,
    });
    expect(await roleOf(viewer)).toBe("admin");
  });

  it("never touches the Owner or creates a second one", async () => {
    await expectAppError(
      owner.client.rpc("change_role", {
        p_workspace: workspace.id,
        p_user: admin.id,
        p_role: "owner",
        p_can_check_in: false,
      }),
      "use_transfer",
    );
    await expectAppError(
      owner.client.rpc("change_role", {
        p_workspace: workspace.id,
        p_user: owner.id,
        p_role: "admin",
        p_can_check_in: false,
      }),
      "use_transfer",
    );
  });

  it("drops check-in when someone becomes Admin", async () => {
    await admin.client.rpc("change_role", {
      p_workspace: workspace.id,
      p_user: viewer.id,
      p_role: "viewer",
      p_can_check_in: true,
    });
    await owner.client.rpc("change_role", {
      p_workspace: workspace.id,
      p_user: viewer.id,
      p_role: "admin",
      p_can_check_in: true,
    });
    const { data } = await owner.client
      .from("workspace_roles")
      .select("role, can_check_in")
      .eq("user_id", viewer.id)
      .single();
    expect(data).toEqual({ role: "admin", can_check_in: false });
  });

  it("refuses Viewers and strangers", async () => {
    await expectAppError(
      viewer.client.rpc("change_role", {
        p_workspace: workspace.id,
        p_user: viewer.id,
        p_role: "viewer",
        p_can_check_in: true,
      }),
      "forbidden",
    );
    await expectAppError(
      stranger.client.rpc("change_role", {
        p_workspace: workspace.id,
        p_user: viewer.id,
        p_role: "viewer",
        p_can_check_in: true,
      }),
      "forbidden",
    );
  });
});

describe("remove_member and leave_workspace", () => {
  it("Admins remove Viewers but not Admins; the Owner removes Admins", async () => {
    await expectAppError(
      admin.client.rpc("remove_member", {
        p_workspace: workspace.id,
        p_user: admin.id,
      }),
      "use_leave",
    );
    const second = await createTestUser();
    await addMember(workspace.id, second.id, "admin");
    await expectAppError(
      admin.client.rpc("remove_member", {
        p_workspace: workspace.id,
        p_user: second.id,
      }),
      "forbidden",
    );
    expect(
      (
        await admin.client.rpc("remove_member", {
          p_workspace: workspace.id,
          p_user: viewer.id,
        })
      ).error,
    ).toBeNull();
    expect(
      (
        await owner.client.rpc("remove_member", {
          p_workspace: workspace.id,
          p_user: second.id,
        })
      ).error,
    ).toBeNull();
    expect(await roleOf(viewer)).toBeNull();
    expect(await roleOf(second)).toBeNull();
  });

  it("nobody removes the Owner", async () => {
    await expectAppError(
      admin.client.rpc("remove_member", {
        p_workspace: workspace.id,
        p_user: owner.id,
      }),
      "forbidden",
    );
  });

  it("members leave; the Owner must transfer first", async () => {
    expect(
      (
        await viewer.client.rpc("leave_workspace", {
          p_workspace: workspace.id,
        })
      ).error,
    ).toBeNull();
    expect(await roleOf(viewer)).toBeNull();
    await expectAppError(
      owner.client.rpc("leave_workspace", { p_workspace: workspace.id }),
      "owner_cannot_leave",
    );
    await expectAppError(
      stranger.client.rpc("leave_workspace", { p_workspace: workspace.id }),
      "not_found",
    );
  });
});

describe("transfer_ownership", () => {
  it("swaps Owner and Admin atomically after the name is typed", async () => {
    await expectAppError(
      owner.client.rpc("transfer_ownership", {
        p_workspace: workspace.id,
        p_new_owner: admin.id,
        p_confirm_name: "robotics club",
      }),
      "name_mismatch",
    );
    const { error } = await owner.client.rpc("transfer_ownership", {
      p_workspace: workspace.id,
      p_new_owner: admin.id,
      p_confirm_name: "Robotics Club",
    });
    expect(error).toBeNull();
    expect(await roleOf(admin)).toBe("owner");
    expect(await roleOf(owner)).toBe("admin");
  });

  it("only transfers to an existing Admin, and only by the Owner", async () => {
    await expectAppError(
      owner.client.rpc("transfer_ownership", {
        p_workspace: workspace.id,
        p_new_owner: viewer.id,
        p_confirm_name: "Robotics Club",
      }),
      "target_not_admin",
    );
    await expectAppError(
      admin.client.rpc("transfer_ownership", {
        p_workspace: workspace.id,
        p_new_owner: admin.id,
        p_confirm_name: "Robotics Club",
      }),
      "forbidden",
    );
  });
});

describe("delete_workspace", () => {
  it("only the Owner deletes, after typing the exact name", async () => {
    await expectAppError(
      admin.client.rpc("delete_workspace", {
        p_workspace: workspace.id,
        p_confirm_name: "Robotics Club",
      }),
      "forbidden",
    );
    await expectAppError(
      owner.client.rpc("delete_workspace", {
        p_workspace: workspace.id,
        p_confirm_name: "Robotics",
      }),
      "name_mismatch",
    );
    expect(
      (
        await owner.client.rpc("delete_workspace", {
          p_workspace: workspace.id,
          p_confirm_name: "Robotics Club",
        })
      ).error,
    ).toBeNull();
    expect(
      (
        await owner.client
          .from("workspaces")
          .select("id")
          .eq("id", workspace.id)
      ).data,
    ).toEqual([]);
    const profile = await owner.client
      .from("profiles")
      .select("last_workspace_id")
      .single();
    expect(profile.data?.last_workspace_id).toBeNull();
  });
});
