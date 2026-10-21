import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { sqlNullable } from "@/server/db/rpc-args";
import { type WorkspaceRole, workspaceRoleSchema } from "@/shared/api/me";
import { createTestUser, type TestUser } from "@/test/db/clients";
import {
  seedShare,
  seedSharedSheet,
  setSheetTeamSharing,
} from "@/test/db/sheet-shares";
import {
  addMember,
  createWorkspaceAs,
  type TestWorkspace,
} from "@/test/db/workspaces";

let owner: TestUser;
let admin: TestUser;
let viewer: TestUser;
let workspace: TestWorkspace;
let restore: () => void = () => undefined;

const sharingSchema = z.object({
  sharing: z
    .object({
      team: z
        .object({
          team_count: z.number(),
          total: z.number(),
          can_view: z.number(),
          cant_open: z.number(),
          in_progress: z.number(),
        })
        .nullable(),
      mine: z.string().nullable(),
      my_email: z.string().nullable(),
    })
    .nullable(),
});
const sharingOf = async (user: TestUser) => {
  const { data, error } = await user.client.rpc("workspace_sheet", {
    p_workspace: workspace.id,
  });
  if (error) {
    throw error;
  }
  return sharingSchema.loose().parse(data).sharing;
};

const pageSchema = z.object({
  has_more: z.boolean(),
  items: z.array(
    z
      .object({
        user_id: z.uuid(),
        role: workspaceRoleSchema,
        sort_name: z.string(),
        sheet_access: z.string().nullable(),
      })
      .loose(),
  ),
});
const membersPage = async (
  user: TestUser,
  after: { role: WorkspaceRole; sort_name: string; user_id: string } | null,
) => {
  const { data, error } = await user.client.rpc("members_page", {
    p_workspace: workspace.id,
    p_role: sqlNullable<WorkspaceRole>(null),
    p_after_role: sqlNullable(after?.role),
    p_after_name: sqlNullable(after?.sort_name),
    p_after_id: sqlNullable(after?.user_id),
    p_limit: 2,
  });
  if (error) {
    throw error;
  }
  return pageSchema.parse(data);
};

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Sheet Owner" });
  admin = await createTestUser({ fullName: "Sara Admin" });
  viewer = await createTestUser({ fullName: "Ali Viewer" });
  workspace = await createWorkspaceAs(owner, "Robotics Club");
  await addMember(workspace.id, admin.id, "admin");
  await addMember(workspace.id, viewer.id, "viewer");
  restore = setSheetTeamSharing(true);
});

afterEach(() => restore());

describe("the sheet's sharing, as each person sees it", () => {
  it("shows the Owner the team's counts and a member their own line", async () => {
    // In the club's account: the Owner, the Admin and the Viewer are all shared with.
    await seedSharedSheet(workspace.id, owner.id);
    await seedShare(workspace.id, {
      userId: admin.id,
      email: admin.email,
      state: "shared",
      permissionId: "perm1",
    });
    await seedShare(workspace.id, {
      userId: viewer.id,
      email: viewer.email,
      state: "refused",
      reason: "refused",
    });
    expect(await sharingOf(owner)).toEqual({
      team: {
        team_count: 2,
        total: 3,
        can_view: 1,
        cant_open: 1,
        in_progress: 1,
      },
      mine: null,
      my_email: null,
    });
    // Admins and Viewers get their own line only, never the Owner's counts.
    expect(await sharingOf(admin)).toEqual({
      team: null,
      mine: "shared",
      my_email: admin.email,
    });
    expect(await sharingOf(viewer)).toEqual({
      team: null,
      mine: "refused",
      my_email: viewer.email,
    });
  });

  it("tells the member whose Google account holds the sheet that it's in their Drive", async () => {
    await seedSharedSheet(workspace.id, owner.id, admin.email.toUpperCase());
    expect(await sharingOf(admin)).toMatchObject({ mine: "sheet_account" });
    expect(await sharingOf(viewer)).toMatchObject({ mine: "sharing" });
    expect((await sharingOf(owner))?.team).toMatchObject({ total: 2 });
  });

  it("counts the team for the connect dialog before there is a sheet", async () => {
    expect(await sharingOf(owner)).toEqual({
      team: {
        team_count: 2,
        total: 0,
        can_view: 0,
        cant_open: 0,
        in_progress: 0,
      },
      mine: null,
      my_email: null,
    });
  });

  it("counts too_many and removed_in_drive as can't open, and external as can view", async () => {
    await seedSharedSheet(workspace.id, owner.id, owner.email);
    await seedShare(workspace.id, {
      userId: admin.id,
      email: admin.email,
      state: "external",
    });
    await seedShare(workspace.id, {
      userId: viewer.id,
      email: viewer.email,
      state: "refused",
      reason: "removed_in_drive",
    });
    expect((await sharingOf(owner))?.team).toMatchObject({
      total: 2,
      can_view: 1,
      cant_open: 1,
      in_progress: 0,
    });
  });

  it("hides sharing while the switch is off", async () => {
    restore();
    restore = setSheetTeamSharing(false);
    await seedSharedSheet(workspace.id, owner.id);
    expect(await sharingOf(owner)).toBeNull();
    expect(await sharingOf(viewer)).toBeNull();
  });
});

describe("who can't open the sheet, in People", () => {
  it("tags only the Owner's view of People, one page at a time", async () => {
    await seedSharedSheet(workspace.id, owner.id);
    await seedShare(workspace.id, {
      userId: admin.id,
      email: admin.email,
      state: "shared",
      permissionId: "perm1",
    });
    await seedShare(workspace.id, {
      userId: viewer.id,
      email: viewer.email,
      state: "refused",
      reason: "too_many",
    });
    const first = await membersPage(owner, null);
    expect(first.has_more).toBe(true);
    expect(first.items.map((row) => [row.user_id, row.sheet_access])).toEqual([
      [owner.id, "pending"],
      [admin.id, "can_view"],
    ]);
    const second = await membersPage(owner, first.items[1]);
    expect(second.items.map((row) => [row.user_id, row.sheet_access])).toEqual([
      [viewer.id, "cant_open"],
    ]);

    const asAdmin = await membersPage(admin, null);
    expect(asAdmin.items.map((row) => row.sheet_access)).toEqual([null, null]);
  });

  it("tags nobody while the switch is off or the sheet's own account is the member", async () => {
    await seedSharedSheet(workspace.id, owner.id, owner.email);
    const own = await membersPage(owner, null);
    expect(own.items[0]).toMatchObject({
      user_id: owner.id,
      sheet_access: null,
    });
    restore();
    restore = setSheetTeamSharing(false);
    const off = await membersPage(owner, null);
    expect(off.items.map((row) => row.sheet_access)).toEqual([null, null]);
  });
});
