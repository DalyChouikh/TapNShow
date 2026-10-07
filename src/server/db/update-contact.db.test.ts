import { beforeEach, describe, expect, it } from "vitest";
import { sqlNullable } from "@/server/db/rpc-args";
import {
  adminClient,
  createTestUser,
  expectAppError,
  type TestUser,
} from "@/test/db/clients";
import { seedContacts, seedList } from "@/test/db/roster";
import {
  addMember,
  createWorkspaceAs,
  type TestWorkspace,
} from "@/test/db/workspaces";

let admin: TestUser;
let workspace: TestWorkspace;
let other: TestWorkspace;

beforeEach(async () => {
  const owner = await createTestUser();
  admin = await createTestUser();
  workspace = await createWorkspaceAs(owner, "A");
  other = await createWorkspaceAs(admin, "B");
  await addMember(workspace.id, admin.id, "admin");
});

describe("update_contact", () => {
  it("changes name and lists in one transaction", async () => {
    const [contact] = await seedContacts(workspace.id, 1, "uc");
    const dev = await seedList(workspace.id, "Dev");
    const ok = await admin.client.rpc("update_contact", {
      p_workspace: workspace.id,
      p_contact: contact,
      p_full_name: "New Name",
      p_email: sqlNullable<string>(null),
      p_list_ids: [dev],
    });
    expect(ok.error).toBeNull();
    const row = await adminClient()
      .from("contacts")
      .select("full_name")
      .eq("id", contact)
      .single();
    expect(row.data?.full_name).toBe("New Name");
    const memberships = await adminClient()
      .from("list_contacts")
      .select("list_id")
      .eq("contact_id", contact);
    expect(memberships.data).toEqual([{ list_id: dev }]);
  });

  it("rejects a contact or list from another workspace and leaves everything unchanged", async () => {
    const [contact] = await seedContacts(workspace.id, 1, "uc2");
    const foreignList = await seedList(other.id, "Foreign");
    await expectAppError(
      admin.client.rpc("update_contact", {
        p_workspace: other.id,
        p_contact: contact,
        p_full_name: "X",
        p_email: sqlNullable<string>(null),
        p_list_ids: sqlNullable<string[]>(null),
      }),
      "not_found",
    );
    await expectAppError(
      admin.client.rpc("update_contact", {
        p_workspace: workspace.id,
        p_contact: contact,
        p_full_name: "Changed",
        p_email: sqlNullable<string>(null),
        p_list_ids: [foreignList],
      }),
      "not_found",
    );
    const row = await adminClient()
      .from("contacts")
      .select("full_name")
      .eq("id", contact)
      .single();
    expect(row.data?.full_name).toBe("uc2 1");
  });
});
