import { beforeEach, describe, expect, it } from "vitest";
import { adminClient, createTestUser, type TestUser } from "@/test/db/clients";
import { seedConnection } from "@/test/db/sender";
import { createWorkspaceAs, type TestWorkspace } from "@/test/db/workspaces";
import {
  getWorkspaceSheet,
  googleConnectionSaved,
  hitGoogleConnectLimit,
  retrySheet,
  startSheet,
  turnOffSheet,
} from "./sheets";

const DRIVE_FILE = "https://www.googleapis.com/auth/drive.file";
let owner: TestUser;
let workspace: TestWorkspace;

beforeEach(async () => {
  owner = await createTestUser({ fullName: "Sheet Owner" });
  workspace = await createWorkspaceAs(owner, "Query Club");
});

describe("sheet queries", () => {
  it("starts a sheet, reads it as the app shows it, and turns it off releasing the account", async () => {
    const connection = await seedConnection(owner.id, { scopes: [DRIVE_FILE] });
    const started = await startSheet(adminClient(), {
      userId: owner.id,
      workspaceId: workspace.id,
      connectionId: connection.id,
      replace: false,
    });
    expect(started).toEqual({
      data: { started: true, released: null },
      error: null,
    });

    const status = await getWorkspaceSheet(owner.client, workspace.id);
    expect(status.error).toBeNull();
    expect(status.data).toMatchObject({
      state: "creating",
      spreadsheetId: null,
      pausedReason: null,
      behind: true,
      turnedOnBy: "Sheet Owner",
      ownerName: "Sheet Owner",
      tabs: [],
    });
    expect(status.data?.accountEmail).toMatch(/@example\.test$/);

    const off = await turnOffSheet(owner.client, workspace.id);
    expect(off.error).toBeNull();
    expect(off.data).toMatchObject({
      googleSub: connection.sub,
      userId: owner.id,
    });
    expect(
      (await getWorkspaceSheet(owner.client, workspace.id)).data?.state,
    ).toBe("off");
  });

  it("passes database errors through in plain codes", async () => {
    expect((await retrySheet(owner.client, workspace.id)).error?.message).toBe(
      "tn:not_found",
    );
    expect(
      (
        await googleConnectionSaved(adminClient(), {
          userId: owner.id,
          connectionId: crypto.randomUUID(),
        })
      ).error,
    ).toBeNull();
    expect(await hitGoogleConnectLimit(owner.client)).toEqual({
      data: true,
      error: null,
    });
  });
});
