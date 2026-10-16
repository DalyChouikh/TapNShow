import { createHash, randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestUser, type TestUser } from "@/test/db/clients";
import { seedMeeting } from "@/test/db/meetings";
import { clearPlatformAdmins, makePlatformAdmin } from "@/test/db/platform";
import { seedEmailedPeople, seedReport } from "@/test/db/reports";
import { createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";
import {
  adminAdmins,
  adminInvite,
  adminInvitePreview,
  adminLog,
  adminOverview,
  adminReports,
  adminWorkspace,
  adminWorkspaces,
  myPlatformRole,
  suspendWorkspace,
} from "./admin";
import { utcDay } from "@/test/utc-day";

/**
 * The TS side of the admin functions' JSON (src/server/queries/admin.ts) parsed against the real
 * database: a renamed or missing key fails here, not in the admin area.
 */
let owner: TestUser;
let workspace: TestWorkspace;

beforeAll(async () => {
  clearPlatformAdmins();
  owner = await createTestUser({ fullName: "Platform Owner" });
  makePlatformAdmin(owner, "owner");
  const member = await createTestUser({ fullName: "Club Owner" });
  workspace = await createWorkspaceAs(member, "Mapped Club");
  const meetingId = await seedMeeting(workspace.id, {
    status: "scheduled",
    created_by: member.id,
  });
  seedEmailedPeople(workspace.id, meetingId, 4);
  seedReport(workspace.id);
  expect((await suspendWorkspace(owner.client, workspace.id)).error).toBeNull();
});

describe("admin queries parse what the database answers", () => {
  it("knows the platform role", async () => {
    expect(await myPlatformRole(owner.client)).toBe("owner");
  });

  it("reads the overview, the lists, one workspace and the log", async () => {
    const overview = await adminOverview(owner.client, {
      from: utcDay(-6),
      to: utcDay(),
    });
    expect(overview.error).toBeNull();
    expect(overview.data?.series.points).toHaveLength(7);
    const list = await adminWorkspaces(owner.client, {
      q: "mapped",
      filter: "suspended",
      sort: "reports",
      after: null,
      limit: 25,
    });
    expect(list.data?.map((row) => row.id)).toContain(workspace.id);
    const detail = await adminWorkspace(owner.client, workspace.id);
    expect(detail.data?.suspensions[0]?.reason).toBe("platform_admin");
    expect(detail.data?.last30.emailsSent).toBe(4);
    const reports = await adminReports(owner.client, null, 25);
    expect(reports.data?.some((row) => row.workspaceId === workspace.id)).toBe(
      true,
    );
    const log = await adminLog(owner.client, "suspensions", null, 25);
    expect(log.data?.[0]).toMatchObject({
      kind: "suspended",
      workspaceName: "Mapped Club",
    });
  });

  it("creates an invite, previews it and lists it masked", async () => {
    const tokenHash = createHash("sha256")
      .update(randomBytes(32))
      .digest("hex");
    const created = await adminInvite(
      owner.client,
      "mapped@example.test",
      tokenHash,
    );
    expect(created.data?.expiresAt).toEqual(expect.any(String));
    const preview = await adminInvitePreview(owner.client, tokenHash);
    expect(preview.data).toEqual({
      status: "already_admin",
      maskedEmail: "m•••@example.test",
    });
    const admins = await adminAdmins(owner.client);
    expect(admins.data?.admins[0]).toMatchObject({
      role: "owner",
      name: "Platform Owner",
    });
    expect(admins.data?.invites.map((invite) => invite.email)).toContain(
      "m•••@example.test",
    );
  });
});
