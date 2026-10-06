import { beforeAll, describe, expect, it } from "vitest";
import {
  adminClient,
  anonClient,
  createTestUser,
  expectAppError,
  type TestUser,
} from "@/test/db/clients";
import {
  addMember,
  createWorkspaceAs,
  type TestWorkspace,
} from "@/test/db/workspaces";

describe("profiles", () => {
  it("are created at sign-up, with Google's name when present", async () => {
    const named = await createTestUser({ fullName: "Amira Ben Ali" });
    const anonymous = await createTestUser();
    const a = await named.client
      .from("profiles")
      .select("display_name")
      .single();
    const b = await anonymous.client
      .from("profiles")
      .select("display_name")
      .single();
    expect(a.data?.display_name).toBe("Amira Ben Ali");
    expect(b.data?.display_name).toBeNull();
  });

  it("are private to their owner", async () => {
    const owner = await createTestUser({ fullName: "Owner" });
    const other = await createTestUser();
    const { data } = await other.client
      .from("profiles")
      .select("user_id")
      .eq("user_id", owner.id);
    expect(data).toEqual([]);
  });

  it("cannot point last_workspace_id at a workspace the user is not in", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    const workspace = await createWorkspaceAs(owner);
    const { error } = await stranger.client
      .from("profiles")
      .update({ last_workspace_id: workspace.id })
      .eq("user_id", stranger.id);
    expect(error?.code).toBe("42501");
  });
});

describe("create_workspace", () => {
  it("makes the caller the Owner and remembers the workspace", async () => {
    const owner = await createTestUser();
    const workspace = await createWorkspaceAs(owner, "  GDG Club  ");
    expect(workspace.name).toBe("GDG Club");
    const roles = await owner.client
      .from("workspace_roles")
      .select("role")
      .eq("workspace_id", workspace.id);
    expect(roles.data).toEqual([{ role: "owner" }]);
    const profile = await owner.client
      .from("profiles")
      .select("last_workspace_id")
      .single();
    expect(profile.data?.last_workspace_id).toBe(workspace.id);
  });

  it("rejects unknown timezones and blank names", async () => {
    const owner = await createTestUser();
    await expectAppError(
      owner.client.rpc("create_workspace", {
        p_name: "X",
        p_slug: "x-abcd",
        p_timezone: "Mars/Olympus",
      }),
      "invalid_timezone",
    );
    await expectAppError(
      owner.client.rpc("create_workspace", {
        p_name: "   ",
        p_slug: "y-abcd",
        p_timezone: "Africa/Tunis",
      }),
      "invalid_input",
    );
  });

  it("stops at the owned-workspace limit", async () => {
    const owner = await createTestUser();
    const admin = adminClient();
    const limit = 10;
    for (let index = 0; index < limit; index += 1) {
      const { data } = await admin
        .from("workspaces")
        .insert({
          name: `W${index}`,
          slug: `w-${crypto.randomUUID().slice(0, 8)}`,
          timezone: "Africa/Tunis",
        })
        .select("id")
        .single();
      await addMember(data!.id, owner.id, "owner");
    }
    await expectAppError(
      owner.client.rpc("create_workspace", {
        p_name: "One more",
        p_slug: "one-more-abcd",
        p_timezone: "Africa/Tunis",
      }),
      "workspace_limit",
    );
  });

  it("rate-limits creation to 5 per hour per user", async () => {
    const owner = await createTestUser();
    for (let index = 0; index < 5; index += 1) {
      await createWorkspaceAs(owner, `Club ${index}`);
    }
    await expectAppError(
      owner.client.rpc("create_workspace", {
        p_name: "Sixth",
        p_slug: `sixth-${crypto.randomUUID().slice(0, 4)}`,
        p_timezone: "Africa/Tunis",
      }),
      "rate_limited",
    );
  });
});

describe("workspace isolation", () => {
  let owner: TestUser;
  let viewer: TestUser;
  let stranger: TestUser;
  let workspace: TestWorkspace;

  beforeAll(async () => {
    owner = await createTestUser({ fullName: "Owner" });
    viewer = await createTestUser({ fullName: "Viewer" });
    stranger = await createTestUser();
    workspace = await createWorkspaceAs(owner);
    await addMember(workspace.id, viewer.id, "viewer");
  });

  it("members read the workspace; strangers and anon do not", async () => {
    expect(
      (
        await viewer.client
          .from("workspaces")
          .select("id")
          .eq("id", workspace.id)
      ).data,
    ).toHaveLength(1);
    expect(
      (
        await stranger.client
          .from("workspaces")
          .select("id")
          .eq("id", workspace.id)
      ).data,
    ).toEqual([]);
    expect(
      (await anonClient().from("workspaces").select("id")).error?.code,
    ).toBe("42501");
  });

  it("Admins rename; Viewers cannot", async () => {
    const byViewer = await viewer.client
      .from("workspaces")
      .update({ name: "Hacked" })
      .eq("id", workspace.id)
      .select("id");
    expect(byViewer.data).toEqual([]);
    const byOwner = await owner.client
      .from("workspaces")
      .update({ name: "Renamed" })
      .eq("id", workspace.id)
      .select("name");
    expect(byOwner.data).toEqual([{ name: "Renamed" }]);
  });

  it("nobody writes workspace_roles directly", async () => {
    const { error } = await owner.client.from("workspace_roles").insert({
      workspace_id: workspace.id,
      user_id: stranger.id,
      role: "admin",
    });
    expect(error?.code).toBe("42501");
  });

  it("list_members shows members with emails, only to members", async () => {
    const { data } = await viewer.client.rpc("list_members", {
      p_workspace: workspace.id,
    });
    expect(data?.map((member) => member.email).sort()).toEqual(
      [owner.email, viewer.email].sort(),
    );
    await expectAppError(
      stranger.client.rpc("list_members", { p_workspace: workspace.id }),
      "forbidden",
    );
  });
});

describe("check_ip_rate_limit", () => {
  it("is not callable by signed-in users", async () => {
    const user = await createTestUser();
    const { error } = await user.client.rpc("check_ip_rate_limit", {
      p_action: "otp_send",
      p_ip: "203.0.113.1",
    });
    expect(error?.code).toBe("42501");
  });

  it("allows 20 OTP requests per IP per hour", async () => {
    const ip = `198.51.100.${Math.floor(Math.random() * 250)}-${crypto.randomUUID().slice(0, 4)}`;
    const results: boolean[] = [];
    for (let index = 0; index < 21; index += 1) {
      const { data } = await adminClient().rpc("check_ip_rate_limit", {
        p_action: "otp_send",
        p_ip: ip,
      });
      results.push(data === true);
    }
    expect(results.slice(0, 20).every(Boolean)).toBe(true);
    expect(results[20]).toBe(false);
  });
});
