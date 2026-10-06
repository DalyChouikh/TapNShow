import { describe, expect, it } from "vitest";
import { createTestUser } from "@/test/db/clients";
import { addMember } from "@/test/db/workspaces";
import { createWorkspace, getWorkspaceBySlug } from "./workspaces";

describe("workspace queries", () => {
  it("creates, then reads by slug with the caller's role; strangers get null", async () => {
    const owner = await createTestUser();
    const viewer = await createTestUser();
    const stranger = await createTestUser();
    const slug = `club-${crypto.randomUUID().slice(0, 4)}`;
    const created = await createWorkspace(owner.client, {
      name: "Club",
      slug,
      timezone: "Africa/Tunis",
    });
    expect(created.error).toBeNull();
    await addMember(created.data!.id, viewer.id, "viewer", true);
    expect(
      await getWorkspaceBySlug(owner.client, owner.id, slug),
    ).toMatchObject({ slug, myRole: "owner", canCheckIn: false });
    expect(
      await getWorkspaceBySlug(viewer.client, viewer.id, slug),
    ).toMatchObject({ myRole: "viewer", canCheckIn: true });
    expect(
      await getWorkspaceBySlug(stranger.client, stranger.id, slug),
    ).toBeNull();
  });
});
