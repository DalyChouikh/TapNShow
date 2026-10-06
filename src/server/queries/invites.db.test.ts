import { describe, expect, it } from "vitest";
import { createTestUser } from "@/test/db/clients";
import { createWorkspaceAs } from "@/test/db/workspaces";
import {
  acceptInvite,
  createInvite,
  getInvite,
  listOpenInvites,
  previewInvite,
  renewInvite,
  revokeInvite,
} from "./invites";

const hash = (): string =>
  `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll("-", "");

describe("invite queries", () => {
  it("create → list → preview → accept, in camelCase", async () => {
    const owner = await createTestUser();
    const invitee = await createTestUser();
    const workspace = await createWorkspaceAs(owner, "Math Club");
    const tokenHash = hash();
    const { data: id } = await createInvite(owner.client, {
      workspaceId: workspace.id,
      email: invitee.email,
      role: "viewer",
      tokenHash,
    });
    const invites = await listOpenInvites(owner.client, workspace.id);
    expect(invites).toEqual([
      expect.objectContaining({
        id,
        email: invitee.email,
        role: "viewer",
        status: "pending",
      }),
    ]);
    expect(await getInvite(owner.client, id!)).toMatchObject({
      email: invitee.email,
      role: "viewer",
    });
    expect(await previewInvite(invitee.client, tokenHash)).toMatchObject({
      status: "ready",
      workspaceName: "Math Club",
      role: "viewer",
    });
    expect((await acceptInvite(invitee.client, tokenHash)).data).toBe(
      workspace.slug,
    );
    expect(await listOpenInvites(owner.client, workspace.id)).toEqual([]);
  });

  it("renews and revokes", async () => {
    const owner = await createTestUser();
    const workspace = await createWorkspaceAs(owner);
    const { data: id } = await createInvite(owner.client, {
      workspaceId: workspace.id,
      email: "x@example.test",
      role: "viewer",
      tokenHash: hash(),
    });
    expect((await renewInvite(owner.client, id!, hash())).error).toBeNull();
    expect((await revokeInvite(owner.client, id!)).error).toBeNull();
    expect(await listOpenInvites(owner.client, workspace.id)).toEqual([]);
  });
});
